// Loads content/strings.<locale>.js and resolves keys like t('welcome.errors.invalid_id', { name }).
let strings = {};

export async function loadStrings(locale) {
  strings = (await import(`/content/strings.${locale}.js`)).default;
}

export function t(key, vars) {
  const value = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), strings);
  if (typeof value !== 'string') {
    console.warn(`Missing string: ${key}`);
    return key;
  }
  return vars ? value.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : value;
}

// Non-string entries (lists, objects), e.g. raw('survey.questions').
export function raw(key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), strings);
}

export function has(key) {
  return typeof key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), strings) === 'string';
}
