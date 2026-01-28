import { createInterface } from 'node:readline';

async function readFromTerminal(initialContent) {
  if (initialContent) {
    console.log('--- Initial Content ---');
    console.log(initialContent);
    console.log('--- End Initial Content ---\n');
    console.log('(Append your text below)');
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  const lines = [];
  if (initialContent) lines.push(initialContent);

  console.log("Please type something. Type 'EOF' (or press Ctrl+Z/D) to end.");

  for await (const line of rl) {
    if (line.trim() === 'EOF') break; 
    lines.push(line);
  }

  const content = lines.join('\n');
  if (content.trim() === '') return null;
  return content;
}

(async () => {
    console.log("Starting test...");
    // @ts-ignore
    const result = await readFromTerminal("Initial text");
    console.log("Result:");
    console.log(JSON.stringify(result));
})();
