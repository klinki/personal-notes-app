import { Command } from 'commander';
import { addNote, getNotes, getBooksRecursive, setDbLocation } from './store';
import { openEditor } from './editor';

const program = new Command();

program
  .name('mnote')
  .description('A simple markdown-based note taking CLI')
  .version('0.1.0')
  .option('--dbLocation <path>', 'Set the database location')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.dbLocation) {
      setDbLocation(opts.dbLocation);
    }
  });

program.command('add')
  .description('Add a note to a book')
  .argument('<book>', 'The name of the book')
  .argument('[content]', 'The content of the note')
  .action(async (book, content) => {
    try {
        if (content) {
            await addNote(book, content);
        } else {
            const editorContent = await openEditor();
            if (editorContent) {
                await addNote(book, editorContent);
            } else {
                console.log('Empty note, not saved.');
            }
        }
    } catch (e: any) {
        console.error('Error adding note:', e.message);
    }
  });

program.command('view')
  .description('View notes in a book')
  .argument('<book>', 'The name of the book')
  .action(async (book) => {
    const notes = await getNotes(book);
    if (notes.length === 0) {
        console.log(`No notes found in book: ${book}`);
        return;
    }
    notes.forEach((note, index) => {
        console.log(`--- Note ${index + 1} (${note.filename}) ---`);
        console.log(note.content);
        console.log('');
    });
  });

program.command('list')
  .description('List all books')
  .action(async () => {
    const books = await getBooksRecursive();
    if (books.length === 0) {
        console.log('No books found.');
    } else {
        books.forEach(book => console.log(book));
    }
  });

program.parse();
