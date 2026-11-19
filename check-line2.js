const fs = require('fs');
const line = fs.readFileSync('apps/host/src/server/dot-agent.ts','utf8').split('\n')[1392];
let crs = [];
for (let i = 0; i < line.length; i++) {
  if (line.charCodeAt(i) === 13) crs.push(i);
}
console.log('carriage returns in line 1393:', crs);
console.log('line length:', line.length);
console.log('ends with backtick-semicolon:', /`;$/.test(line.trimEnd()));

// Find the outer template opening and closing
let bt = [];
for (let i = 0; i < line.length; i++) if (line[i] === '`') bt.push(i);
console.log('backtick positions:', bt);
