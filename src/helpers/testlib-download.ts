import https from 'https';

export function downloadFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            downloadFile(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Failed to download file. HTTP status: ${response.statusCode}`
            )
          );
          return;
        }

        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        response.on('end', () => {
          resolve(data);
        });
      })
      .on('error', err => {
        reject(new Error(`Download failed: ${err.message}`));
      });
  });
}
