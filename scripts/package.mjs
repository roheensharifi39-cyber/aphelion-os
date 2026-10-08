import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function isWithin(directory, candidate) {
  const path = relative(directory, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function assertLocalBuildPath(path, projectDirectory) {
  if (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(path)) {
    throw new Error('Packaging needs a local drive path; network and device paths are unsupported.');
  }
  const syncedRoots = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean);
  if (isWithin(projectDirectory, path) || syncedRoots.some(root => isWithin(resolve(root), path)) || path.split(/[\\/]/).some(part => /^OneDrive(?: - .+)?$/i.test(part))) {
    throw new Error('Packaging needs a local folder outside the project and OneDrive. Set APHELION_PACKAGE_ROOT to an absolute local path.');
  }
}

export async function createPackageDirectory(projectDirectory, requestedRoot = process.env.APHELION_PACKAGE_ROOT || tmpdir()) {
  if (!isAbsolute(requestedRoot)) throw new Error('APHELION_PACKAGE_ROOT must be an absolute path.');
  const projectPath = await realpath(projectDirectory);
  const rootPath = resolve(requestedRoot);
  assertLocalBuildPath(rootPath, projectPath);
  await mkdir(rootPath, { recursive: true });
  const actualRoot = await realpath(rootPath);
  assertLocalBuildPath(actualRoot, projectPath);
  const buildDirectory = await realpath(await mkdtemp(join(actualRoot, 'aphelion-package-')));
  if (!isWithin(actualRoot, buildDirectory) || !basename(buildDirectory).startsWith('aphelion-package-')) {
    throw new Error('The packaging directory escaped its local temporary root.');
  }
  return buildDirectory;
}

async function assertArtifactDestination(path) {
  const existing = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink > 1)) {
    throw new Error(`Refusing to overwrite a linked or non-file artifact: ${path}`);
  }
}

export async function packageWindows() {
  const projectPath = await realpath(projectDirectory);
  const manifest = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'));
  await stat(join(projectPath, 'dist', 'index.html'));
  const buildDirectory = await createPackageDirectory(projectPath);
  const outputDirectory = join(buildDirectory, 'release');
  console.log(`Packaging in ${buildDirectory}`);

  // Electron extraction removes and renames output folders. Keep all of those
  // operations in this fresh local directory, away from OneDrive file locks.
  const { build, Platform } = await import('electron-builder');
  const artifacts = await build({
    projectDir: projectPath,
    targets: Platform.WINDOWS.createTarget('portable'),
    publish: 'never',
    config: { directories: { output: outputDirectory } },
  });
  const portableName = `Aphelion-OS-${manifest.version}-portable.exe`;
  const portableSource = artifacts.find(path => basename(path) === portableName);
  if (!portableSource || !isWithin(buildDirectory, resolve(portableSource))) {
    throw new Error(`The portable artifact ${portableName} was not created inside the packaging directory.`);
  }
  const unpackedDirectories = (await readdir(outputDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^win(?:-[a-z0-9]+)?-unpacked$/.test(entry.name));
  if (unpackedDirectories.length !== 1) throw new Error('Expected one unpacked Windows app for the desktop smoke test.');
  const unpackedExecutable = join(outputDirectory, unpackedDirectories[0].name, `${manifest.build.productName}.exe`);
  await stat(unpackedExecutable);

  const releasePath = join(projectPath, 'release');
  await mkdir(releasePath, { recursive: true });
  const releaseDirectory = await realpath(releasePath);
  if (!isWithin(projectPath, releaseDirectory)) throw new Error('The release folder must remain inside the project.');
  const portableExecutable = join(releaseDirectory, portableName);
  const packageInfo = join(releaseDirectory, 'package-info.json');
  await assertArtifactDestination(portableExecutable);
  await assertArtifactDestination(packageInfo);
  await copyFile(portableSource, portableExecutable);
  await writeFile(packageInfo, `${JSON.stringify({
    version: manifest.version,
    portableExecutable,
    unpackedExecutable,
    buildDirectory,
  }, null, 2)}\n`);
  console.log(`Portable app: ${portableExecutable}`);
  console.log(`Desktop smoke executable: ${unpackedExecutable}`);
  console.log('Build files are retained in the local temporary folder. Existing release folders are preserved.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageWindows().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
