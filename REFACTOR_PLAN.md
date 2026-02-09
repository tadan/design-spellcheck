# Refactoring Plan

## Phase 1: Setup & Foundation ✅ IN PROGRESS

### 1.1 Repository Setup ✅
- [x] Connect to GitHub
- [x] Create comprehensive README
- [x] Add .gitignore
- [x] Create analysis documentation
- [ ] Add LICENSE file
- [ ] Create initial commit

### 1.2 Development Environment
- [ ] Set up package.json
- [ ] Configure TypeScript
- [ ] Set up Vite build
- [ ] Configure ESLint + Prettier
- [ ] Add Git hooks (husky)

### 1.3 Project Structure
```bash
# Create directory structure
mkdir -p src/{plugin,ui}/{scanners,rules,utils,components,styles}
mkdir -p tests/{unit,integration}
mkdir -p docs
```

---

## Phase 2: Core Refactoring

### 2.1 Extract Backend Modules
**Priority: HIGH**

1. **Scanners** (`src/plugin/scanners/`)
   - `hidden-scanner.ts` - Extract `scanHidden()`
   - `properties-scanner.ts` - Extract `scanProperties()`
   - `variables-scanner.ts` - Extract `scanVariables()`
   - `names-scanner.ts` - Extract `scanNames()`
   - `hierarchy-scanner.ts` - Extract `scanHierarchy()`

2. **Rules** (`src/plugin/rules/`)
   - `naming-rules.ts` - Extract naming validation logic
   - `property-rules.ts` - Extract property validation
   - `hierarchy-rules.ts` - Extract property ordering rules

3. **Utils** (`src/plugin/utils/`)
   - `node-utils.ts` - Node traversal, path building
   - `string-utils.ts` - camelCase, levenshtein, sanitization
   - `variable-utils.ts` - Variable lookups, suggestions
   - `progress.ts` - Progress reporting

### 2.2 Extract UI Modules
**Priority: HIGH**

1. **Components** (`src/ui/components/`)
   - `tabs.ts` - Tab switching logic
   - `progress-bar.ts` - Progress indicator
   - `section.ts` - Collapsible sections
   - `item.ts` - Result item component
   - `stats.ts` - Statistics display

2. **Results** (`src/ui/components/results/`)
   - `hidden-results.ts`
   - `property-results.ts`
   - `variable-results.ts`
   - `name-results.ts`
   - `hierarchy-results.ts`

3. **Styles** (`src/ui/styles/`)
   - Extract CSS from HTML
   - Create modular stylesheets
   - Add CSS variables for theming

### 2.3 Type System
**Priority: HIGH**

Create comprehensive TypeScript types:

```typescript
// src/plugin/types.ts
export interface ScanMessage {
  type: ScanType;
  scope: ScanScope;
}

export type ScanType =
  | 'scan-hidden'
  | 'scan-properties'
  | 'scan-variables'
  | 'scan-names'
  | 'scan-hierarchy';

export type ScanScope = 'page' | 'file' | 'selection';

export interface BaseItem {
  id: string;
  name: string;
  type: string;
  page: string;
  path: string;
}

export interface NameIssue extends BaseItem {
  issues: string[];
  reason: string;
  suggested: string;
  contentHint: string;
  parentName: string;
}

// ... many more types
```

---

## Phase 3: Quality & Testing

### 3.1 Unit Tests
**Priority: MEDIUM**

Test files to create:
- `tests/unit/naming-rules.test.ts`
- `tests/unit/string-utils.test.ts`
- `tests/unit/hierarchy-rules.test.ts`
- `tests/unit/variable-utils.test.ts`

### 3.2 Integration Tests
**Priority: MEDIUM**

- Mock Figma API
- Test scanner workflows
- Test message passing
- Test UI rendering

### 3.3 Code Quality
**Priority: MEDIUM**

- Add ESLint rules
- Add Prettier config
- Set up pre-commit hooks
- Add CI/CD (GitHub Actions)

---

## Phase 4: Performance Optimization

### 4.1 Scanning Performance
**Priority: LOW**

- Implement Web Workers for scanning
- Add result streaming
- Optimize node traversal
- Cache scan results

### 4.2 UI Performance
**Priority: MEDIUM**

- Virtual scrolling for large lists
- Incremental rendering
- Debounce user inputs
- Lazy load result categories

---

## Phase 5: Feature Enhancements

### 5.1 Export Functionality
- CSV export
- JSON export
- Shareable reports

### 5.2 Keyboard Navigation
- Tab navigation
- Shortcut keys
- Focus management

### 5.3 Undo/Redo
- Action history
- Rollback operations
- Batch undo

---

## Phase 6: Documentation

### 6.1 Code Documentation
- JSDoc comments
- Type documentation
- Architecture diagrams

### 6.2 User Documentation
- User guide
- Video tutorials
- FAQ

### 6.3 Developer Documentation
- Contributing guide
- API documentation
- Development setup

---

## Migration Strategy

### Step-by-Step Migration

#### Week 1: Foundation
1. Set up TypeScript + Vite
2. Create project structure
3. Configure build system
4. Test basic plugin load

#### Week 2: Backend
1. Extract scanners one by one
2. Add types
3. Test each scanner
4. Maintain backward compatibility

#### Week 3: Frontend
1. Extract UI components
2. Modularize styles
3. Test UI rendering
4. Maintain functionality

#### Week 4: Polish
1. Add tests
2. Optimize performance
3. Update documentation
4. Prepare release

---

## Risk Management

### Risks:

1. **Breaking Figma API compatibility**
   - Mitigation: Test on multiple Figma versions
   - Keep fallback code for older APIs

2. **Performance regression**
   - Mitigation: Benchmark before/after
   - Keep performance tests

3. **Loss of functionality**
   - Mitigation: Comprehensive testing
   - User acceptance testing

4. **Build complexity**
   - Mitigation: Keep build simple
   - Document thoroughly

---

## Success Metrics

### Code Quality:
- [ ] 80%+ test coverage
- [ ] Zero TypeScript errors
- [ ] Zero ESLint errors
- [ ] Under 200KB bundle size

### Performance:
- [ ] < 5s scan for 10K nodes
- [ ] < 200ms UI render
- [ ] < 100ms user interaction

### Developer Experience:
- [ ] < 5 min setup time
- [ ] Hot reload working
- [ ] Clear error messages
- [ ] Good documentation

---

## Next Actions

1. ✅ Create README
2. ✅ Create ANALYSIS.md
3. ✅ Create .gitignore
4. ⏳ Add LICENSE
5. ⏳ Initial commit & push
6. ⏳ Set up package.json
7. ⏳ Configure TypeScript
8. ⏳ Start Phase 1 refactoring

---

## Timeline

**Estimated Total:** 4-6 weeks

- Week 1: Setup & Foundation
- Week 2: Backend Refactoring
- Week 3: Frontend Refactoring
- Week 4: Testing & Polish
- Week 5-6: Documentation & Release Prep
