#!/usr/bin/env node
/* eslint-disable */

const fs = require('fs');
const path = require('path');

// Read the packages list
const packagesListPath = path.join(__dirname, 'packages_list.txt');
const packagesContent = fs.readFileSync(packagesListPath, 'utf8');
const packagesToCheck = packagesContent
  .split('\n')
  .filter(line => line.trim())
  .map(line => {
    const [name, version] = line.split(':');
    return { name: name.trim(), expectedVersion: version ? version.trim() : null };
  });

// Read package.json for direct dependencies
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const directDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.peerDependencies,
  ...packageJson.optionalDependencies
};

// Read package-lock.json for all dependencies (including transient)
const packageLockPath = path.join(__dirname, 'package-lock.json');
let packageLock = null;
try {
  packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
} catch (error) {
  console.error('Error reading package-lock.json:', error.message);
  process.exit(1);
}

// Function to find which package depends on a transient dependency
function findDependencyChain(packageName, packages, visited = new Set(), chain = []) {
  if (visited.has(packageName)) {
    return null;
  }
  visited.add(packageName);

  // Check if it's a direct dependency
  if (directDependencies[packageName]) {
    return [packageName];
  }

  // Search through all packages to find who requires this package
  for (const [pkgName, pkgData] of Object.entries(packages)) {
    if (pkgData.dependencies && pkgData.dependencies[packageName]) {
      // Check if this parent is a direct dependency
      if (directDependencies[pkgName]) {
        return [pkgName, packageName];
      }
      // Otherwise, recursively find the chain
      const parentChain = findDependencyChain(pkgName, packages, visited, chain);
      if (parentChain) {
        return [...parentChain, packageName];
      }
    }
  }

  return null;
}

// Get all packages from package-lock.json
const allPackages = packageLock.packages || {};

// Build a reverse dependency map for faster lookup
const reverseDeps = {};
for (const [pkgPath, pkgData] of Object.entries(allPackages)) {
  if (pkgData.dependencies) {
    for (const depName of Object.keys(pkgData.dependencies)) {
      if (!reverseDeps[depName]) {
        reverseDeps[depName] = [];
      }
      // Extract clean package name from path
      const cleanPath = pkgPath === '' ? 'ROOT' : pkgPath.replace(/^node_modules\//, '').split('/node_modules/').pop();
      reverseDeps[depName].push(cleanPath);
    }
  }
}

// Function to find the direct dependency that requires a package
function findDirectDependency(packageName, visited = new Set()) {
  if (visited.has(packageName)) {
    return null;
  }
  visited.add(packageName);

  // Check if it's already a direct dependency
  if (directDependencies[packageName]) {
    return { direct: packageName, chain: [packageName] };
  }

  // Find packages that depend on this one
  const parents = reverseDeps[packageName] || [];
  
  for (const parent of parents) {
    if (parent === 'ROOT') continue;
    
    // If parent is a direct dependency, we found it
    if (directDependencies[parent]) {
      return { direct: parent, chain: [parent, packageName] };
    }
    
    // Otherwise, recursively search
    const result = findDirectDependency(parent, visited);
    if (result) {
      result.chain.push(packageName);
      return result;
    }
  }

  return null;
}

// Function to get version from package-lock.json
function getInstalledVersion(packageName) {
  for (const [pkgPath, pkgData] of Object.entries(allPackages)) {
    const cleanPath = pkgPath.replace(/^node_modules\//, '').split('/node_modules/').pop();
    if (cleanPath === packageName || pkgPath.endsWith(`/${packageName}`)) {
      return pkgData.version || null;
    }
  }
  return null;
}

// Function to check if versions match (allowing for semver flexibility)
function versionsMatch(installed, expected) {
  if (!installed || !expected) return false;
  
  // Exact match
  if (installed === expected) return true;
  
  // Remove leading ^ or ~ from expected version
  const cleanExpected = expected.replace(/^[\^~]/, '');
  
  // Check if installed version satisfies the expected version
  // For simplicity, we'll check if they match after removing prefixes
  if (installed === cleanExpected) return true;
  
  // Check if installed starts with the major version of expected
  const installedParts = installed.split('.');
  const expectedParts = cleanExpected.split('.');
  
  // If ^ is used, major version must match
  if (expected.startsWith('^') && installedParts[0] === expectedParts[0]) {
    return true;
  }
  
  // If ~ is used, major and minor must match
  if (expected.startsWith('~') && installedParts[0] === expectedParts[0] && installedParts[1] === expectedParts[1]) {
    return true;
  }
  
  return false;
}

// Results
const results = {
  direct: [],
  transient: [],
  notFound: []
};

console.log('Checking packages...\n');

// Check each package
for (const packageInfo of packagesToCheck) {
  const packageName = packageInfo.name;
  const expectedVersion = packageInfo.expectedVersion;
  
  // Check if it's a direct dependency
  if (directDependencies[packageName]) {
    const installedVersion = directDependencies[packageName];
    const versionMatches = expectedVersion ? versionsMatch(installedVersion.replace(/^[\^~]/, ''), expectedVersion) : null;
    
    results.direct.push({
      name: packageName,
      expectedVersion: expectedVersion,
      installedVersion: installedVersion,
      versionMatch: expectedVersion ? versionMatches : 'N/A'
    });
    continue;
  }

  // Check if it exists anywhere in the dependency tree
  let found = false;
  
  // Check in package-lock packages
  for (const pkgPath of Object.keys(allPackages)) {
    const cleanPath = pkgPath.replace(/^node_modules\//, '').split('/node_modules/').pop();
    
    if (cleanPath === packageName || pkgPath.includes(`/${packageName}`) || pkgPath.endsWith(packageName)) {
      found = true;
      const installedVersion = getInstalledVersion(packageName);
      const versionMatches = expectedVersion ? versionsMatch(installedVersion, expectedVersion) : null;
      const depInfo = findDirectDependency(packageName);
      
      if (depInfo) {
        results.transient.push({
          name: packageName,
          expectedVersion: expectedVersion,
          installedVersion: installedVersion,
          versionMatch: expectedVersion ? versionMatches : 'N/A',
          requiredBy: depInfo.direct,
          chain: depInfo.chain
        });
      } else {
        results.transient.push({
          name: packageName,
          expectedVersion: expectedVersion,
          installedVersion: installedVersion,
          versionMatch: expectedVersion ? versionMatches : 'N/A',
          requiredBy: 'unknown',
          chain: []
        });
      }
      break;
    }
  }

  if (!found) {
    results.notFound.push({
      name: packageName,
      expectedVersion: expectedVersion
    });
  }
}

// Print results
console.log('═══════════════════════════════════════════════════════════');
console.log('DIRECT DEPENDENCIES FOUND');
console.log('═══════════════════════════════════════════════════════════');
if (results.direct.length > 0) {
  results.direct.forEach(pkg => {
    const versionStatus = pkg.versionMatch === true ? '✓ MATCH' : pkg.versionMatch === false ? '✗ MISMATCH' : 'N/A';
    const versionColor = pkg.versionMatch === true ? '\x1b[32m' : pkg.versionMatch === false ? '\x1b[31m' : '\x1b[33m';
    console.log(`\n✓ ${pkg.name}`);
    console.log(`  └─ Expected: ${pkg.expectedVersion || 'N/A'}`);
    console.log(`  └─ Installed: ${pkg.installedVersion}`);
    console.log(`  └─ Version Status: ${versionColor}${versionStatus}\x1b[0m`);
  });
} else {
  console.log('None found.');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('TRANSIENT DEPENDENCIES FOUND');
console.log('═══════════════════════════════════════════════════════════');
if (results.transient.length > 0) {
  results.transient.forEach(pkg => {
    const versionStatus = pkg.versionMatch === true ? '✓ MATCH' : pkg.versionMatch === false ? '✗ MISMATCH' : 'N/A';
    const versionColor = pkg.versionMatch === true ? '\x1b[32m' : pkg.versionMatch === false ? '\x1b[31m' : '\x1b[33m';
    console.log(`\n✓ ${pkg.name}`);
    console.log(`  └─ Expected: ${pkg.expectedVersion || 'N/A'}`);
    console.log(`  └─ Installed: ${pkg.installedVersion || 'N/A'}`);
    console.log(`  └─ Version Status: ${versionColor}${versionStatus}\x1b[0m`);
    console.log(`  └─ Required by: ${pkg.requiredBy}`);
    if (pkg.chain.length > 1) {
      console.log(`  └─ Full chain: ${pkg.chain.join(' → ')}`);
    }
  });
} else {
  console.log('None found.');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Total packages checked: ${packagesToCheck.length}`);
console.log(`Direct dependencies found: ${results.direct.length}`);
console.log(`Transient dependencies found: ${results.transient.length}`);
console.log(`Not found in project: ${results.notFound.length}`);

// Count version matches and mismatches
const allFound = [...results.direct, ...results.transient];
const withVersionInfo = allFound.filter(pkg => pkg.expectedVersion);
const versionMatches = withVersionInfo.filter(pkg => pkg.versionMatch === true).length;
const versionMismatches = withVersionInfo.filter(pkg => pkg.versionMatch === false).length;

if (withVersionInfo.length > 0) {
  console.log(`\nVersion Analysis (for packages with expected versions):`);
  console.log(`  ✓ Matching versions: ${versionMatches}`);
  console.log(`  ✗ Mismatched versions: ${versionMismatches}`);
}
console.log('═══════════════════════════════════════════════════════════\n');

// Optionally save results to a file
const outputPath = path.join(__dirname, 'dependency-check-results.json');
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Results saved to: ${outputPath}\n`);
