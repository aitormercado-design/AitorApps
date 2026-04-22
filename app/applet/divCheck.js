const fs = require('fs');

const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');

const startIndex = 2246; // line 2247
const endIndex = 3580; // line 3581

let openDivs = 0;
for (let i = startIndex; i < endIndex; i++) {
  const line = lines[i];
  const opens = (line.match(/<div/g) || []).length;
  const closes = (line.match(/<\/div>/g) || []).length;
  openDivs += opens - closes;
  if(opens !== closes) {
      console.log(`Line ${i + 1}: +${opens} -${closes} = ${openDivs}`);
  }
}
console.log(`Open divs left at end of AnimatePresence: ${openDivs}`);
