# Contributing to 1ai-omniroute

Thank you for your interest in contributing to 1ai-omniroute! This document provides guidelines and instructions for contributing.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [How to Contribute](#how-to-contribute)
3. [Development Setup](#development-setup)
4. [Creating Patches](#creating-patches)
5. [Testing](#testing)
6. [Pull Request Process](#pull-request-process)
7. [Issue Reporting](#issue-reporting)

## Code of Conduct

This project adheres to a Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the maintainers.

## How to Contribute

### Types of Contributions

1. **Bug Fixes**: Fix issues in existing patches or scripts
2. **New Features**: Add new patches or enhance existing functionality
3. **Documentation**: Improve README, add examples, fix typos
4. **Testing**: Add test cases or improve test coverage
5. **Code Review**: Review pull requests and provide feedback

### Getting Started

1. Fork the repository
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/1ai-omniroute.git
   cd 1ai-omniroute
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Prerequisites

- Node.js 22.x or higher
- Python 3.8+ (for provider catalog patcher)
- Bash 4.x (for update scripts)
- OmniRoute installed globally: `npm install -g omniroute`

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/1ai-omniroute/1ai-omniroute.git
   cd 1ai-omniroute
   ```

2. **Symlink patches for development**:
   ```bash
   # Create patches directory if it doesn't exist
   mkdir -p ~/.omniroute/patches
   
   # Symlink your development patches
   ln -sf $(pwd)/patches/* ~/.omniroute/patches/
   ```

3. **Test patches**:
   ```bash
   # Start OmniRoute with patches
   omniroute --no-open
   
   # Check if patches are loaded
   # Look for: "🩹 Loaded X openclaw patch(es)"
   ```

## Creating Patches

### Patch Structure

All patches should be `.cjs` files in the `patches/` directory:

```javascript
/**
 * OpenClaw OmniRoute Modular Patch: [Patch Name]
 * ===============================================
 * [Brief description of what this patch does]
 * 
 * MODULAR: Add/remove .cjs patch files in ~/.omniroute/patches/
 * SURVIVES UPDATES: Re-applied on each OmniRoute startup
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

// Patch configuration here

// ─── Patch Logic ─────────────────────────────────────────────────────────────

// Main patch logic here

// ─── Execution ───────────────────────────────────────────────────────────────

// Apply patch when module is loaded
```

### Best Practices

1. **Idempotency**: Patches should be safe to run multiple times
2. **Error Handling**: Gracefully handle errors and provide helpful messages
3. **Logging**: Use `console.log()` with prefix for debug info
4. **Documentation**: Include JSDoc comments explaining the patch
5. **Testing**: Test with different OmniRoute versions

### Example Patch

```javascript
/**
 * OpenClaw OmniRoute Modular Patch: Example Patch
 * ================================================
 * This patch demonstrates the structure of a modular patch.
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const PATCH_NAME = 'example-patch';

// ─── Patch Logic ─────────────────────────────────────────────────────────────

function applyPatch() {
  console.log(`[${PATCH_NAME}] ✅ Patch applied successfully`);
  // Your patch logic here
}

// ─── Execution ───────────────────────────────────────────────────────────────

applyPatch();
```

## Testing

### Manual Testing

1. **Start OmniRoute**:
   ```bash
   omniroute --no-open --port 20128
   ```

2. **Check patch loading**:
   ```bash
   # Should show: "🩹 Loaded X openclaw patch(es)"
   omniroute --help
   ```

3. **Test functionality**:
   ```bash
   # Test API endpoints
   curl http://localhost:20128/v1/models
   ```

### Automated Testing

Coming soon! We plan to add automated tests for patches.

## Pull Request Process

### Before Submitting

1. **Update documentation**: Update README.md and PATCHES.md
2. **Test thoroughly**: Ensure patches work with different OmniRoute versions
3. **Check code style**: Follow existing code style
4. **Update changelog**: Add entry to CHANGELOG.md

### PR Requirements

- [ ] Clear description of changes
- [ ] Related issue numbers (if applicable)
- [ ] Updated documentation
- [ ] All tests pass (when available)
- [ ] Follows coding standards

### Review Process

1. Maintainers will review your PR
2. Feedback may be provided for improvements
3. Once approved, your PR will be merged

## Issue Reporting

### Bug Reports

When reporting bugs, please include:

1. **OmniRoute version**: `omniroute --version`
2. **Node.js version**: `node --version`
3. **Operating system**: `uname -a` or `ver`
4. **Steps to reproduce**: Detailed steps
5. **Expected behavior**: What should happen
6. **Actual behavior**: What actually happens
7. **Error logs**: Any error messages

### Feature Requests

When requesting features, please:

1. **Describe the problem**: What problem does this solve?
2. **Propose a solution**: How should this be implemented?
3. **Consider alternatives**: What other solutions are possible?
4. **Provide context**: Use cases and examples

## Development Workflow

### Adding a New Patch

1. Create a new branch: `git checkout -b feature/new-patch`
2. Create patch file in `patches/` directory
3. Test the patch with OmniRoute
4. Update documentation:
   - Add to README.md
   - Add to PATCHES.md
   - Update CHANGELOG.md
5. Submit pull request

### Updating Existing Patches

1. Create a new branch: `git checkout -b fix/update-patch`
2. Modify the patch file
3. Test the changes
4. Update documentation if needed
5. Submit pull request

## Code Style

### JavaScript/TypeScript

- Use `'use strict';` in all `.cjs` files
- Follow existing code style in the project
- Use descriptive variable names
- Add comments for complex logic

### Bash Scripts

- Use `#!/usr/bin/env bash` shebang
- Set `set -euo pipefail` for safety
- Use descriptive function names
- Add comments for complex commands

### Python Scripts

- Follow PEP 8 style guide
- Use type hints where appropriate
- Add docstrings to functions
- Use descriptive variable names

## Getting Help

- **Issues**: Create an issue on GitHub
- **Discussions**: Use GitHub Discussions
- **Documentation**: Check README.md and docs/

## License

By contributing to 1ai-omniroute, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to 1ai-omniroute! Your help makes this project better for everyone.
