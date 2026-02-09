# Design Spellcheck (CLOS-UI)

> A comprehensive Figma plugin for auditing and fixing design system quality issues

[![Figma Plugin](https://img.shields.io/badge/Figma-Plugin-F24E1E?logo=figma&logoColor=white)](https://www.figma.com)
[![Version](https://img.shields.io/badge/version-2026--02--08--01-blue)](https://github.com/tadan/design-spellcheck)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Created during the **IDS Hackathon** (Feb 6-8, 2025)

---

## 🎯 What It Does

Design Spellcheck is your design system quality assistant. It scans your Figma files and identifies:

- 🙈 **Hidden layers** that might be artifacts or forgotten elements
- 🏷️ **Poor naming** conventions (default names, short names, unnamed auto-layouts)
- 🧩 **Component property issues** (naming, missing properties, unused instances)
- 🎨 **Variable/token problems** (unused, missing bindings, naming inconsistencies)
- 📐 **Hierarchy issues** (incorrect property ordering in components)

---

## ✨ Features

### 🔍 Five Powerful Scanners

#### 1. Hidden Layer Scanner
Categorizes all hidden layers in your file:
- **Expected**: Hidden layers inside components (intentional design)
- **Suspicious**: Hidden layers outside components (potential issues)
- **Artifacts**: 0x0 size or generic-named hidden layers (cleanup needed)

#### 2. Names Scanner
Finds layers with problematic names:
- Default Figma names (`Frame 1`, `Rectangle 47`)
- Very short names (1-2 characters)
- Unnamed auto-layout frames
- Provides intelligent rename suggestions

#### 3. Properties Scanner
Audits component properties for:
- Non-camelCase naming
- Use of "status" instead of "state"
- Use of "variants" instead of "variant"
- Use of "display/screen" instead of "viewport"
- Components without properties
- Instances using only default values

#### 4. Variables Scanner
Comprehensive variable/token audit:
- **Unused variables**: Not bound to any nodes
- **Missing bindings**: Hardcoded values that should use variables
  - Padding, Gap, Border Radius, Border Width
  - Fill colors, Stroke colors
- **Naming issues**: Orphans, missing descriptions, misplaced tokens
- Suggests closest matching variables

#### 5. Hierarchy Inspector
- Visualizes component property tree
- Validates property order (size → state → variant → boolean → text → label)
- One-click fix for incorrect ordering

### ⚡ Bulk Operations

- **Select All**: Select all issues in a category
- **Fix All**: Apply suggested fixes to all selected items
- **Batch Rename**: Rename multiple layers at once
- **Bulk Bind**: Bind multiple variables in one action
- **Quick Delete**: Remove suspicious hidden layers

### 📊 Real-Time Statistics

- Total nodes scanned
- Clean vs. problematic layers
- Component health score
- Variable usage rate

---

## 🚀 Installation

### Option 1: From Figma Community (Coming Soon)
1. Visit the [Figma Community](https://www.figma.com/community)
2. Search for "Design Spellcheck" or "CLOS-UI"
3. Click "Install"

### Option 2: Development Mode
1. Download or clone this repository:
   ```bash
   git clone https://github.com/tadan/design-spellcheck.git
   cd design-spellcheck
   ```

2. Open Figma Desktop (not browser)

3. Go to `Plugins` → `Development` → `Import plugin from manifest...`

4. Select the `manifest.json` file from this repository

5. Run the plugin: `Plugins` → `Development` → `CLOS-UI`

---

## 📖 Usage

### Quick Start

1. **Open your Figma file**
2. **Run the plugin**: `Plugins` → `CLOS-UI`
3. **Choose a scanner** from the tabs
4. **Select scope**:
   - Current Page
   - Entire File
   - Selection (for Properties/Variables)
5. **Click Scan**
6. **Review results** and apply fixes

### Best Practices

#### Hidden Layers
- Review "Suspicious" category first
- Delete "Artifacts" safely
- Keep "Expected" layers (component slots)

#### Names
- Start with "Default / Generic Names"
- Use suggested names or customize
- Focus on auto-layout frames

#### Properties
- Fix property names before values
- Use camelCase consistently
- Follow the "state" not "status" rule

#### Variables
- Review "Missed Variables" first
- Bind suggested variables
- Clean up unused variables last
- Add descriptions to all tokens

#### Hierarchy
- Run on component sets
- Apply fix to reorder properties
- Follow size → state → variant → boolean → text pattern

---

## 🎨 Design System Best Practices

### Naming Conventions

#### Component Properties:
- ✅ `size`, `state`, `variant`, `showIcon`, `label`
- ❌ `Size`, `status`, `variants`, `show_icon`, `Label Text`

#### Property Values:
- ✅ `small`, `medium`, `large`, `default`, `hover`, `pressed`
- ❌ `Small`, `md`, `Default State`, `hover-state`

#### Variables:
- ✅ `spacing/sm`, `color/brand/primary`, `radius/md`
- ❌ `Spacing Small`, `brand-primary`, `borderRadius8`

### Property Order:
1. **size** - Component size variants
2. **state** - Interactive states (default, hover, pressed, disabled)
3. **variant** - Visual variants (primary, secondary, tertiary)
4. **boolean** - Toggle properties (showIcon, withBorder)
5. **text** - Text content properties
6. **label** - Label/title properties

### Variable Structure:
```
Foundation/
  ├── color/
  │   ├── brand/primary
  │   ├── brand/secondary
  │   └── neutral/background
  ├── spacing/
  │   ├── xs (4px)
  │   ├── sm (8px)
  │   ├── md (16px)
  │   └── lg (24px)
  └── radius/
      ├── sm (4px)
      ├── md (8px)
      └── lg (16px)

Component/
  ├── button/
  ├── input/
  └── card/
```

---

## 🛠️ Development

### Project Structure

```
design-spellcheck/
├── manifest.json       # Plugin metadata
├── code.js            # Plugin backend (main thread)
├── ui.html            # Plugin UI (iframe)
├── variable-icon.svg  # Variable indicator
├── ANALYSIS.md        # Technical analysis
└── README.md          # This file
```

### Future Architecture (Refactor Plan)

```
src/
├── plugin/            # Backend code
│   ├── main.ts
│   ├── scanners/
│   ├── rules/
│   └── utils/
└── ui/               # Frontend code
    ├── components/
    ├── styles/
    └── utils/
```

### Tech Stack

**Current:**
- Vanilla JavaScript
- Figma Plugin API
- No dependencies

**Planned:**
- TypeScript
- Vite
- Jest (testing)
- ESLint + Prettier

### Building

Currently no build step required. Future refactor will include:

```bash
npm install
npm run build    # Build for production
npm run dev      # Build and watch
```

---

## 🐛 Known Issues

1. Large files (10K+ nodes) can take 10-15 seconds to scan
2. Property rename sometimes fails on published library components
3. No undo for bulk operations (use with caution)
4. Limited to 200 items per category in UI

---

## 🗺️ Roadmap

### v1.1
- [ ] TypeScript migration
- [ ] Modern build system (Vite)
- [ ] Unit tests
- [ ] Virtual scrolling for large result sets

### v1.2
- [ ] Export results to CSV/JSON
- [ ] Keyboard shortcuts
- [ ] Undo/redo support
- [ ] Text style scanning

### v1.3
- [ ] Effect style scanning
- [ ] Auto-fix on save
- [ ] Custom naming rules
- [ ] Integration with CI/CD

---

## 📝 Changelog

### 2026-02-08-01 (Current)
- ✨ Complete scanner suite
- ✨ Bulk operations
- ✨ Real-time statistics
- ✨ Property hierarchy validation
- 🐛 Fixed hierarchy scan error
- 🎨 Updated branding to CLOS-UI

### Initial Release (2026-02-06)
- 🎉 First release from IDS Hackathon
- ✨ Hidden layer scanner
- ✨ Name scanner
- ✨ Property scanner

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention

```
feat(scope): description     # New feature
fix(scope): description      # Bug fix
refactor(scope): description # Code refactoring
docs(scope): description     # Documentation
test(scope): description     # Tests
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 👏 Credits

**Created by:** [Your Name]
**Hackathon:** IDS Hackathon (Feb 6-8, 2025)
**Built with:** ❤️ and ☕

---

## 🔗 Links

- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- [Figma Community](https://www.figma.com/community)
- [Issue Tracker](https://github.com/tadan/design-spellcheck/issues)

---

## 📧 Contact

Have questions or suggestions? Open an issue or reach out!

---

**Made with ❤️ for the design community**
