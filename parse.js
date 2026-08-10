const fs = require('fs');
const data = fs.readFileSync('reverse-findings/findings 4 full.txt', 'utf8');

const ops = [...data.matchAll(/\\"operationName\\":\\"([^\\"]+)\\"/g)].map(m => m[1]);
const hashes = [...data.matchAll(/\\"sha256Hash\\":\\"([^\\"]+)\\"/g)].map(m => m[1]);

const uniqueOps = new Set(ops);
console.log('Operations:', [...uniqueOps]);
const results = {};
for(let i=0; i<ops.length; i++) {
  if(ops[i] && hashes[i]) results[ops[i]] = hashes[i];
}
console.log(JSON.stringify(results, null, 2));
