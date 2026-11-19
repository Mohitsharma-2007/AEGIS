const fs = require('fs');
const line = fs.readFileSync('apps/host/src/server/dot-agent.ts','utf8').split('\n')[1392];
const myText = line.substring(907, 2160);
let nonAscii = [];
for (let i = 0; i < myText.length; i++) {
  if (myText.charCodeAt(i) > 127) nonAscii.push([907 + i, myText[i], myText.charCodeAt(i)]);
}
console.log('non-ascii in my region:', JSON.stringify(nonAscii));
console.log('has backtick in region:', myText.includes('`'));
console.log('has dollar-brace:', myText.includes('${'));
console.log('region length:', myText.length);
