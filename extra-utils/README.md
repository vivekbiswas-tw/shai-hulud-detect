# Dependency Checker Utility

## Overview

This utility checks for transient (indirect) dependencies in your Node.js project against a list of known compromised packages.

## Usage

### Step 1: Copy Required Files

Copy the following files to your project's root directory:

- `check-dependencies.js`
- `packages_list.txt`

### Step 2: Run the Checker

Execute the dependency checker:

```bash
node check-dependencies.js
```

## Output

The utility provides results in two formats:

1. **Console Output** - Results are displayed directly in the terminal
2. **JSON Report** - A detailed report is saved to `dependency-check-results.json` in your project's root directory

## Requirements

- Node.js installed on your system
- A valid `package.json` file in your project root
- `node_modules` directory (run `npm install` first if needed)

## Notes

- This tool is part of the Shai-Hulud detection toolkit
- It specifically checks for compromised packages in your dependency tree
- Review the generated JSON file for detailed findings
