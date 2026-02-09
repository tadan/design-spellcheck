# Design Spellcheck Plugin - Analysis & Refactoring Plan

**Date:** 2026-02-09
**Version:** 2026-02-08-01 (current)

---

## Overview

Design Spellcheck (CLOS-UI) is a comprehensive Figma plugin that audits design files for quality issues. Created during the IDS Hackathon Feb 6-8, 2025.

## Plugin Capabilities

### 1. Hidden Layer Scanner
- Categorizes hidden layers into:
  - **Expected**: Component slots (hidden layers inside components)
  - **Suspicious**: Intentionally hidden layers outside components
  - **Artifacts**: 0x0 size or generic-named layers
- Provides bulk delete and selection capabilities

### 2. Properties Scanner
- Audits component properties for:
  - Missing property definitions
  - Non-camelCase naming
  - Use of "status" instead of "state"
  - Use of "variants" instead of "variant"
  - Use of "display/screen/breakpoint" instead of "viewport"
- Checks instances for default-only usage
- Provides rename and bulk fix capabilities

### 3. Variables Scanner
- Audits design tokens/variables for:
  - **Unused variables**: Identifies variables not bound to any nodes
  - **Missing variable bindings**: Hardcoded values that should use variables
    - Padding, Gap, Border Radius, Border Width
    - Fill colors, Stroke colors
  - **Naming issues**:
    - Orphans (no group path with `/`)
    - Missing descriptions
    - Misplaced tokens (component-specific under Global/)
- Suggests closest matching variables
- Bulk binding and removal operations

### 4. Names Scanner
- Finds layers with poor names:
  - **Default names**: "Frame 1", "Rectangle 47", etc.
  - **Short names**: 1-2 character names
  - **Unnamed auto-layout frames**: Structural frames needing names
- Provides intelligent suggestions:
  - From text content
  - From parent names
  - From similar frequent names
  - From layer type
- Bulk rename operations

### 5. Hierarchy Inspector
- Shows component property tree with:
  - Property definitions
  - Instance overrides
  - Bound variable counts
- Validates property order according to best practices:
  1. size
  2. state
  3. variant
  4. boolean
  5. text content
  6. label content
- One-click fix for incorrect ordering

---

## Current Code Structure

### Files
- `manifest.json` - Plugin metadata
- `code.js` (48KB) - Plugin backend (main thread)
- `ui.html` (81KB) - UI iframe (React-like vanilla JS)
- `variable-icon.svg` - Variable indicator icon

### Architecture
```
┌─────────────────────────────────────────┐
│           Figma Plugin API              │
│                                         │
│  ┌──────────────┐      ┌─────────────┐ │
│  │   code.js    │◄────►│   ui.html   │ │
│  │   (main)     │ msgs │  (iframe)   │ │
│  └──────┬───────┘      └─────────────┘ │
│         │                               │
└─────────┼───────────────────────────────┘
          │
          ▼
    Figma Canvas
```

---

## Refactoring Opportunities

### 1. Code Organization

#### Current Issues:
- All code in single files (1500+ lines in code.js, 2200+ lines in ui.html)
- Mixed concerns (scanning logic, naming rules, UI rendering)
- No separation between business logic and presentation

#### Proposed Structure:
```
design-spellcheck/
├── manifest.json
├── src/
│   ├── plugin/
│   │   ├── main.ts                 # Entry point
│   │   ├── scanners/
│   │   │   ├── hidden-scanner.ts
│   │   │   ├── properties-scanner.ts
│   │   │   ├── variables-scanner.ts
│   │   │   ├── names-scanner.ts
│   │   │   └── hierarchy-scanner.ts
│   │   ├── rules/
│   │   │   ├── naming-rules.ts
│   │   │   ├── property-rules.ts
│   │   │   └── hierarchy-rules.ts
│   │   ├── utils/
│   │   │   ├── node-utils.ts
│   │   │   ├── string-utils.ts
│   │   │   ├── variable-utils.ts
│   │   │   └── progress.ts
│   │   └── message-handler.ts
│   │
│   └── ui/
│       ├── index.html
│       ├── main.ts
│       ├── components/
│       │   ├── tabs.ts
│       │   ├── progress-bar.ts
│       │   ├── results/
│       │   │   ├── hidden-results.ts
│       │   │   ├── property-results.ts
│       │   │   ├── variable-results.ts
│       │   │   ├── name-results.ts
│       │   │   └── hierarchy-results.ts
│       │   └── shared/
│       │       ├── item.ts
│       │       ├── section.ts
│       │       └── stats.ts
│       ├── styles/
│       │   ├── main.css
│       │   ├── components.css
│       │   └── tabs.css
│       └── utils/
│           ├── dom.ts
│           └── messages.ts
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
└── README.md
```

### 2. TypeScript Migration

**Benefits:**
- Type safety for Figma API
- Better IDE support
- Catch errors at compile time
- Self-documenting code

**Priority Types:**
```typescript
// Message types
interface ScanMessage {
  type: 'scan-hidden' | 'scan-properties' | 'scan-variables' | 'scan-names' | 'scan-hierarchy';
  scope: 'page' | 'file' | 'selection';
}

// Result types
interface HiddenLayerItem {
  id: string;
  name: string;
  type: string;
  page: string;
  path: string;
}

interface PropertyIssue {
  id: string;
  name: string;
  type: string;
  variantName: string;
  propName: string;
  reason: string;
  suggested: string;
}

// ... and many more
```

### 3. Modern Build Setup

**Current:** Plain JS files
**Proposed:** TypeScript + Vite

**Benefits:**
- Hot module reloading during development
- Tree shaking for smaller bundles
- CSS modules or styled-components
- Source maps for debugging
- Auto-versioning

### 4. Code Quality Improvements

#### Naming Conventions:
- Use descriptive variable names
- Consistent function naming (verb + noun)
- Clear parameter names

#### Error Handling:
- Add comprehensive try-catch blocks
- User-friendly error messages
- Logging for debugging

#### Performance:
- Implement virtual scrolling for large result lists
- Debounce search/filter operations
- Lazy load result categories

### 5. UI/UX Enhancements

#### Current Issues:
- Hard-coded CSS in HTML
- Limited keyboard navigation
- No undo/redo support
- No export functionality

#### Proposed Improvements:
- Component-based UI architecture
- Keyboard shortcuts
- Export results to CSV/JSON
- Dark mode support (already themed, but enhance)
- Batch operations status tracking
- Undo/redo for renaming operations

### 6. Testing Infrastructure

**Add:**
- Unit tests for naming rules
- Unit tests for scanners
- Integration tests for message passing
- Mock Figma API for testing

**Tools:**
- Jest for unit tests
- Testing Library for DOM tests
- Mock Service Worker for API mocking

### 7. Documentation

**Add:**
- Developer guide
- Architecture documentation
- API documentation
- Contributing guidelines
- User manual

---

## Implementation Priority

### Phase 1: Foundation (2-3 days)
1. Set up TypeScript + Vite build
2. Create basic project structure
3. Extract scanners to separate modules
4. Add types for Figma API interactions

### Phase 2: Core Refactoring (3-4 days)
1. Refactor code.js into modules
2. Extract UI components
3. Implement message type system
4. Add error handling

### Phase 3: Quality & Polish (2-3 days)
1. Add tests
2. Improve UI components
3. Add keyboard navigation
4. Performance optimizations

### Phase 4: Documentation & Release (1-2 days)
1. Write comprehensive README
2. Add inline documentation
3. Create development guide
4. Prepare for release

---

## Technical Debt

### Critical:
1. No error boundaries
2. No logging system
3. Hardcoded strings (should be constants)
4. No validation on user inputs

### Medium:
1. CSS in HTML (should be external)
2. No component reusability
3. Duplicate code in UI rendering
4. No accessibility support (ARIA labels, keyboard nav)

### Low:
1. Magic numbers throughout code
2. Inconsistent code style
3. No code comments
4. Version sync between code.js and ui.html is manual

---

## Performance Analysis

### Current Performance:
- Scans 1000 nodes: ~1-2 seconds
- Large file (10K+ nodes): ~10-15 seconds
- UI rendering: ~500ms for 200 items

### Bottlenecks:
1. Synchronous node traversal
2. DOM manipulation for each item
3. No virtual scrolling
4. Full page re-renders

### Optimization Opportunities:
1. Web Workers for scanning
2. Virtual scrolling for results
3. Incremental rendering
4. Result pagination
5. Cached scans

---

## Naming Rules Reference

### Current Rules:
1. **camelCase enforcement**
2. **"state" not "status"**
3. **"variant" not "variants"**
4. **"viewport" not "display/screen/breakpoint"**
5. **No spaces in names**

### Property Order:
1. size
2. state
3. variant
4. boolean
5. text content
6. label content

---

## Variable Binding Logic

### Detection:
- Scans all nodes for hardcoded numeric values
- Checks: padding, gap, radius, border width
- Checks: fill colors, stroke colors

### Suggestion Algorithm:
1. Exact match by value
2. Closest numeric value (smallest diff)
3. Special case: 0 → "none" variable

### Naming Patterns:
- Orphans: no `/` in name
- Misplaced: Global/* containing component terms
- Missing desc: empty description field

---

## Git Strategy

### Branches:
- `main` - stable releases
- `develop` - active development
- `feature/*` - new features
- `refactor/*` - refactoring work
- `fix/*` - bug fixes

### Commit Convention:
```
type(scope): description

feat(scanner): add text style scanning
fix(ui): correct property rename logic
refactor(core): extract naming rules to module
docs(readme): add installation guide
test(scanner): add unit tests for hidden layer scanner
```

---

## Dependencies to Add

### Development:
```json
{
  "typescript": "^5.0.0",
  "vite": "^5.0.0",
  "vite-plugin-singlefile": "^2.0.0",
  "@figma/plugin-typings": "^1.90.0",
  "@types/node": "^20.0.0",
  "prettier": "^3.0.0",
  "eslint": "^8.0.0"
}
```

### Testing:
```json
{
  "jest": "^29.0.0",
  "@testing-library/dom": "^9.0.0",
  "@testing-library/jest-dom": "^6.0.0"
}
```

---

## Next Steps

1. ✅ Connect to GitHub repository
2. ⏳ Create refactoring branch
3. ⏳ Set up TypeScript + Vite
4. ⏳ Extract scanners to modules
5. ⏳ Add comprehensive README
6. ⏳ Push to GitHub

---

## Notes

- Plugin was built in 48 hours during hackathon
- Clean, functional code but needs production-grade structure
- UI is well-designed but tightly coupled to logic
- No dependencies currently (vanilla JS)
- Runs entirely client-side (no network access)
- Team library permissions required for some operations
