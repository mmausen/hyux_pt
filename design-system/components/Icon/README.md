# Icon

SAP's icon font in the Horizon style ("SAP-icons-v5"), rendered as inline SVG path data from `@ui5/webcomponents-icons@2.9.0`; icons inherit `color`.

**Markup:** `<span class="fh-icon" data-icon="search"></span>`, sizes `fh-icon--l` (1.5rem), `fh-icon--xl` (2rem); default 1rem. A page includes the loader script from the README (Iconography) once; it fills every `[data-icon]`. Names are the UI5 icon names: browse them in the UI5 Icon Explorer.

Icon-only buttons need an `aria-label`. Color: `sapContent_IconColor` for interactive icons outside buttons, `sapContent_NonInteractiveIconColor` for decorative ones, semantic element colors for state icons.
