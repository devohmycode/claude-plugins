# Accessibility

Target: **WCAG 2.2 level AA**, read from the source. The scan renders nothing — it cannot
measure a real contrast ratio on a photograph or hear a screen reader; say so in the report,
and confirm the important findings in a browser.

## Description

Accessibility scan of a web front end, from its source. Axis: keyboard operability and focus
management, then names and roles of interactive elements, then text alternatives, then colour
and contrast declared in styles, then motion and reduced-motion support, then forms (labels,
errors, required fields), then page structure (landmarks, heading order, language). Every
finding names the component, the user who is blocked, and the WCAG success criterion.

## Investigation

- Interactive elements: clickable `div`/`span` without role, tabindex and keyboard handler;
  links used as buttons and buttons used as links; icon-only buttons without an accessible
  name; nested interactive elements.
- Focus: dialogs, drawers and menus that do not trap and restore focus; `outline: none`
  without a visible replacement; focus order diverging from visual order.
- Text alternatives: images without `alt`, decorative images not marked as such, SVG icons
  conveying meaning without a title.
- Colour: contrast of text colours declared in design tokens against their backgrounds;
  information conveyed by colour alone.
- Motion: animations, auto-play, parallax or auto-scroll without a `prefers-reduced-motion`
  alternative or a pause control.
- Forms: inputs without associated label; errors not announced (no `aria-live`, no
  `aria-describedby`); required state only shown visually.
- Structure: missing `lang`, skipped heading levels, missing main landmark, page title.
- Check each design or theme variant the project declares, not only the default one.

## Triage

HIGH (blocks a user)

- A control that cannot be reached or operated with the keyboard.
- A dialog that loses focus or cannot be closed with Escape.
- An interactive element without an accessible name.
- Body text below 4.5:1 contrast.

MEDIUM

- Missing reduced-motion alternative for a large or continuous animation.
- Form errors not announced; labels not associated.
- Heading structure broken on a main page.

LOW / INFO

- Redundant ARIA; minor landmark issues.

NEVER REPORT (generic)

- Contrast of text over a photograph that the source cannot determine: classify info with a
  note to verify in a browser.
- Third-party widgets the project does not control, unless the project overlay says
  otherwise.

## Report

Each finding cites the component and line, the user it blocks (keyboard user, screen reader
user, low vision, vestibular disorder…), the WCAG 2.2 criterion, and how to confirm it in a
browser. Group by criterion. State that the scan renders no page.

## Remediation

ACCESSIBILITY — in addition to the common rules

- Prefer the native element (`button`, `a`, `label`, `dialog`) over ARIA on a generic
  element.
- A visual change (contrast, focus ring) is made in the design tokens, never with a
  one-off override.
- A keyboard fix comes with a test that drives the component with the keyboard.

## Exclusions

```
node_modules/**
vendor/**
dist/**
build/**
out/**
.next/**
coverage/**
test-results/**
docs/**
tests/**
scripts/**
**/*.min.js
**/*.map
```
