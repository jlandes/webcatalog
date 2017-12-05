const { https } = require('follow-redirects');
const argv = require('yargs-parser')(process.argv.slice(1));
const createAppAsync = require('@webcatalog/molecule');
const fs = require('fs-extra');
const isUrl = require('is-url');
const path = require('path');
const tmp = require('tmp');

const {
  id,
  name,
  url,
  icon,
  allAppPath,
  homePath,
  moleculeVersion,
} = argv;

const iconDirPath = path.join(homePath, '.webcatalog', 'icons');

const createTmpDirAsync = () =>
  new Promise((resolve, reject) => {
    tmp.dir({ unsafeCleanup: true }, (err, dirPath, cleanupCallback) => {
      if (err) {
        return reject(err);
      }

      return resolve({ dirPath, cleanupCallback });
    });
  });

const downloadFileTempAsync = filePath =>
  createTmpDirAsync()
    .then((tmpObj) => {
      const iconFileName = `${id}.png`;
      const iconPath = path.join(tmpObj.dirPath, iconFileName);

      if (isUrl(filePath)) {
        return new Promise((resolve, reject) => {
          const iconFile = fs.createWriteStream(iconPath);

          const req = https.get(filePath, (response) => {
            response.pipe(iconFile);

            iconFile.on('error', (err) => {
              tmpObj.cleanupCallback();
              reject(err);
            });

            iconFile.on('finish', () => {
              resolve({ iconPath, cleanupCallback: tmpObj.cleanupCallback });
            });
          });

          req.on('error', (err) => {
            tmpObj.cleanupCallback();
            reject(err);
          });
        });
      }

      return fs.copy(filePath, iconPath)
        .then(() => ({ iconPath, cleanupCallback: tmpObj.cleanupCallback }));
    });

downloadFileTempAsync(icon)
  .then(tmpIconObj =>
    createAppAsync(
      id,
      name,
      url,
      tmpIconObj.iconPath,
      allAppPath,
    )
      .then((destPath) => {
        let symlinks;
        switch (process.platform) {
          case 'darwin': {
            symlinks = [
              path.join('Contents', 'Resources', 'app.asar'), // 299.1 MB
              path.join('Contents', 'Resources', 'app.asar.unpacked', 'node_modules'), // 25.6 MB
              path.join('Contents', 'Frameworks', 'Electron Framework.framework'), // 118 MB
            ];
            break;
          }
          case 'win32': {
            symlinks = [
              path.join('resources', 'app.asar'), // 251 MB
              // path.join('resources', 'app.asar.unpacked', 'node_modules'), // 22.1 MB
              'content_shell.pak', // 11.4 MB
              'node.dll', // 17.7 MB
            ];
            break;
          }
          case 'linux': {
            symlinks = [
              path.join('resources', 'app.asar'), // 172 MB
              path.join('resources', 'app.asar.unpacked', 'node_modules'), // 7.2 MB
              'content_shell.pak', // 12.0 MB
              'libnode.so', // 21.1 MB
              'icudtl.dat', // 10.MB
              'libffmpeg.so', // 3.0 MB
              'snapshot_blob.bin', // 1.4 MB
            ];
            break;
          }
          default:
            symlinks = [];
        }

        return Promise.resolve()
          .then(() => {
            const versionPath = path.join(homePath, '.webcatalog', 'versions', moleculeVersion);

            const p = symlinks.map((l) => {
              const origin = path.join(destPath, l);
              const dest = path.join(versionPath, l);

              if (process.platform === 'win32') return null;

              return fs.pathExists(dest)
                .then((exists) => {
                  if (exists) return fs.remove(origin);
                  return fs.move(origin, dest, { overwrite: true });
                })
                .then(() => fs.ensureSymlink(dest, origin));
            });

            return Promise.all(p);
          })
          .then(() => fs.copy(tmpIconObj.iconPath, path.join(iconDirPath, `${id}.png`)))
          .then(() => {
            if (process.platform === 'linux') {
              const execPath = path.join(destPath, name);
              const desktopFilePath = path.join(homePath, '.local', 'share', 'applications', `webcatalog-${id}.desktop`);
              const desktopFileContent = `[Desktop Entry]
            Name=${name}
            Exec="${execPath}"
            Icon=${path.join(iconDirPath, `${id}.png`)}
            Type=Application`;

              return fs.outputFile(desktopFilePath, desktopFileContent);
            }

            return null;
          });
      })
      .then(() => {
        tmpIconObj.cleanupCallback();
        process.exit(0);
      }))
  .catch((e) => {
    process.send(JSON.stringify({
      message: e.message,
      stack: e.stack,
    }));
    process.exit(1);
  });

process.on('uncaughtException', (e) => {
  process.send(JSON.stringify({
    message: e.message,
    stack: e.stack,
  }));
  process.exit(1);
});
