const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// First pass: replace simple strings to template literals 
// e.g. className="something text-lime-400 something" -> className={`something ${themeStyles.accent} something`}
content = content.replace(/className="([^"]*(?:text-lime-[0-9]+|bg-lime-[0-9]+|border-lime-[0-9]+)[^"]*)"/g, (match, p1) => {
    let replaced = p1;
    replaced = replaced.replace(/text-lime-[0-9]+/g, '${themeStyles.accent}');
    replaced = replaced.replace(/bg-lime-[0-9]+\/[0-9]+/g, '${themeStyles.accentMuted}');
    replaced = replaced.replace(/bg-lime-[0-9]+(\/[0-9]+)?/g, '${themeStyles.accentBg}$1');
    replaced = replaced.replace(/border-lime-[0-9]+(\/[0-9]+)?/g, '${themeStyles.accentBorder}$1');
    replaced = replaced.replace(/shadow-lime-[0-9]+(\/[0-9]+)?/g, 'shadow-[0_0_15px_rgba(16,185,129,0.3)]'); // Simplification for shadows
    replaced = replaced.replace(/hover:bg-lime-[0-9]+/g, 'hover:opacity-80');
    replaced = replaced.replace(/hover:border-lime-[0-9]+/g, 'hover:${themeStyles.accentBorder}');
    replaced = replaced.replace(/hover:text-lime-[0-9]+/g, 'hover:${themeStyles.accent}');
    return 'className={`' + replaced + '`}';
});

// Second pass: replace already template literals
content = content.replace(/className=\{`([^`]*?(?:text-lime-|bg-lime-|border-lime-|shadow-lime-|hover:text-lime-|hover:bg-lime-|hover:border-lime-)[^`]*?)`\}/g, (match, p1) => {
    let replaced = p1;
    replaced = replaced.replace(/text-lime-[0-9]+/g, '${themeStyles.accent}');
    replaced = replaced.replace(/bg-lime-[0-9]+\/[0-9]+/g, '${themeStyles.accentMuted}');
    replaced = replaced.replace(/bg-lime-[0-9]+(\/[0-9]+)?/g, '${themeStyles.accentBg}$1');
    replaced = replaced.replace(/border-lime-[0-9]+(\/[0-9]+)?/g, '${themeStyles.accentBorder}$1');
    replaced = replaced.replace(/shadow-lime-[0-9]+(\/[0-9]+)?/g, 'shadow-[0_0_15px_rgba(16,185,129,0.3)]'); // Simplified safely
    replaced = replaced.replace(/hover:bg-lime-[0-9]+/g, 'hover:opacity-80');
    replaced = replaced.replace(/hover:border-lime-[0-9]+/g, 'hover:${themeStyles.accentBorder}');
    replaced = replaced.replace(/hover:text-lime-[0-9]+/g, 'hover:${themeStyles.accent}');
    replaced = replaced.replace(/focus:border-lime-[0-9]+/g, 'focus:${themeStyles.accentBorder}');
    replaced = replaced.replace(/focus:ring-lime-[0-9]+\/[0-9]+/g, '');
    return 'className={`' + replaced + '`}';
});

content = content.replace(/prose-h2:text-lime-400/g, 'prose-h2:${themeStyles.accent}');
content = content.replace(/bg-gradient-to-b from-lime-400\/20 to-transparent/g, '${themeStyles.accentMuted}');
content = content.replace(/border-t-2 border-lime-400/g, 'border-t-2 ${themeStyles.accentBorder}');

// Fixes for cases missed
content = content.replace(/hover:text-lime-[0-9]+/g, 'hover:${themeStyles.accent}');
content = content.replace(/text-lime-[0-9]+/g, '${themeStyles.accent}');

// ChartJS color replacements
content = content.replace(/const primaryColor = \[163, 230, 53\]; \/\/ lime-400/g, "const primaryColor = profile.theme === 'light' ? [16, 185, 129] : [163, 230, 53];");

fs.writeFileSync('src/App.tsx', content);
