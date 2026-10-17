const assert=require('node:assert/strict');
const fs=require('node:fs');
const {renderFnosDescription}=require('./fnos-description');
const description=renderFnosDescription('packaging/fnos');
assert.match(description,/noVNC/);
assert.equal(/[;"\r\n]/.test(description),false);
const images=[...description.matchAll(/<img src='data:image\/jpeg,([^']+)'[^>]*>/g)];
assert.equal(images.length,4);
for(const [index,match]of images.entries()) {
  const bytes=Buffer.from(match[1].split('%').slice(1).map(value=>parseInt(value,16)));
  assert.deepEqual(bytes,fs.readFileSync('packaging/fnos/poster/'+['terminal.jpg','sftp.jpg','mobile-terminal.jpg','mobile-sftp.jpg'][index]));
}
const manifest=fs.readFileSync('packaging/fnos/manifest','utf8').replace('@DESCRIPTION@',description);
// Model the delimiter handling seen in fnOS's installed manifest, rather
// than merely checking the unparsed input copied into the package.
const parsed=manifest.split(/\r?\n/).find(line=>line.startsWith('desc=')).split(';')[0].slice(5);
assert.equal(parsed,description);
assert.equal(parsed.endsWith('</p>'),true);
assert.equal(/@[A-Z_]+@/.test(description),false);
assert.match(description, /<h3/);
assert.match(description, /<table/);
console.log('fnOS description passed: four intact offline images, section layout, exact JPEG bytes and no INI delimiters');
