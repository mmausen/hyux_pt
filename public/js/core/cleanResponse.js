// Removes what a model puts around the text it was asked for: an introduction ("Here is the revised
// version:", "Shortened to five sentences:", "Sure! Here's the email.") and a closing comment ("Let me
// know if you'd like any changes to the draft.", "Note: I kept the placeholders."). Participants should
// see only the draft itself.
// Used by the server on every finished response (the stored response is the cleaned one; the raw text
// is kept and logged when something was removed) and by the browser while a response streams in.
//
//   cleanResponse(text)                    → the text without introduction and closing comment
//   cleanResponse(text, { partial: true }) → the same for text that is still streaming: an opening line
//                                            that is not finished yet, or an opening paragraph that looks
//                                            like an introduction, is held back until it is complete.
//
// To stay clear of the draft itself, a paragraph is only removed when it is short, is the very first or
// very last one, starts like a comment AND talks about the text (version, draft, sentences, tone ...).
// "Great news, Laura!" or a closing "Let me know if you'd like to meet." stay.

const META = /\b(?:versions?|drafts?|revis\w*|rewrit\w*|rewrote|updat\w*|shorten\w*|tighten\w*|sentences?|words|text|e-?mails?|letters?|proposals?|messages?|tone|wording|changes|edit\w*|below|placeholders?|assum\w*|brackets?|paragraphs?|opening|closing|greeting|sign-?off|structure)\b/i;

// Ways a comment about the text starts.
const INTRO = new RegExp('^(?:' + [
  'here(?:\'s|’s| is| are)\\b',
  'below (?:is|are)\\b',
  '(?:sure|certainly|of course|absolutely|okay|ok|got it|done)[!.,:]',
  'i(?:\'ve|’ve| have)? ?(?:revised|updated|rewritten|rewrote|shortened|tightened|edited|adjusted|reworked|changed|made|added|kept|removed|focused|incorporated)\\b',
  '(?:this|the) (?:revised|updated|new|shorter|longer|final|following|edited) (?:version|draft)\\b',
  '(?:revised|updated|new|shorter|shortened|edited|final|improved) (?:version|draft)\\b',
].join('|') + ')', 'i');

const OUTRO = new RegExp('^(?:' + [
  'let me know\\b',
  'i hope this\\b',
  'feel free to\\b',
  'if you(?:\'d|’d| would) like\\b',
  'would you like me to\\b',
  '(?:notes?|assumptions?|changes(?: made)?):',
  'i assumed\\b',
  'i(?:\'ve|’ve| have) (?:revised|updated|rewritten|shortened|tightened|edited|adjusted|reworked|kept|added|removed|made|focused|incorporated|left)\\b',
  '(?:this|the) (?:revised |updated |new )?(?:version|draft)\\b',
].join('|') + ')', 'i');

// Opening lines that belong to a draft even though they may end with a colon ("Dear Ms Lee:").
const DRAFT_START = /^(?:dear|hi|hello|to|re|attn|subject|betreff)\b/i;

const isComment = (para, starts) => para.length <= 400 && starts.test(para) && META.test(para);
// "Shortened to five sentences:" — a short opening line that ends with a colon.
const isLabelLine = (line) => line.endsWith(':') && line.split(/\s+/).length <= 12 && !DRAFT_START.test(line) && META.test(line);
const SEPARATOR = /^(?:-{3,}|\*{3,}|_{3,})$/;

export function cleanResponse(text, { partial = false } = {}) {
  if (typeof text !== 'string' || !text) return text ?? '';
  let s = text.replace(/^\s+/, '');

  // Introduction: a label line, or a first paragraph that comments on the text.
  for (let pass = 0; pass < 2; pass++) {
    const nl = s.indexOf('\n');
    // Still streaming the first line: hold it back until it is complete (a fraction of a second).
    if (partial && nl === -1) return '';
    const firstLine = (nl === -1 ? s : s.slice(0, nl)).trim();
    const para = s.indexOf('\n\n');
    const firstPara = (para === -1 ? s : s.slice(0, para)).trim();
    if (isLabelLine(firstLine)) {
      if (!s.slice(nl + 1).trim()) return partial ? '' : s; // nothing after the label (yet)
      s = s.slice(nl + 1).replace(/^\s+/, '');
    } else if (INTRO.test(firstLine) && (partial && para === -1 ? true : isComment(firstPara, INTRO))) {
      // Streaming and the paragraph is not finished: hold it back until it can be judged.
      if (para === -1) return partial ? '' : s;
      s = s.slice(para + 2).replace(/^\s+/, '');
    } else break;
    // A separator line right under the introduction.
    s = s.replace(/^(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\n+|$)/, '');
  }

  // Closing comment, possibly behind a separator line.
  for (let pass = 0; pass < 2; pass++) {
    const trimmed = s.replace(/\s+$/, '');
    const cut = trimmed.lastIndexOf('\n\n');
    if (cut === -1) break;
    const last = trimmed.slice(cut + 2).trim().replace(/^(?:-{3,}|\*{3,}|_{3,})[ \t]*\n+/, '');
    if (!isComment(last, OUTRO)) break;
    s = trimmed.slice(0, cut).replace(/\n+[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/, '');
  }
  s = s.replace(/\s+$/, '');
  return SEPARATOR.test(s) ? '' : s;
}
