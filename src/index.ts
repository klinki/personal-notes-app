import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { addNote, getNotes, getBooksRecursive, setDbLocation, deleteNote, findNotes, getDbInfo, getNote, updateNote, moveNote, renameBook, rebuildDB, checkDB } from './store';
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
  .option('-t, --title <title>', 'The title of the note')
  .action(async (book, content, options) => {
    try {
        if (content) {
            await addNote(book, content, options.title);
        } else {
            const editorContent = await openEditor();
            if (editorContent) {
                await addNote(book, editorContent, options.title);
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

program.command('delete')
  .description('Delete a note from a book')
  .argument('<book>', 'The name of the book')
  .argument('<index>', 'The index of the note to delete')
  .option('-f, --force', 'Skip confirmation')
  .action(async (book, index, options) => {
    try {
        if (!options.force) {
            const readline = createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise<string>(resolve => {
                readline.question(`Are you sure you want to delete note ${index} from book "${book}"? (y/N) `, resolve);
            });
            
            readline.close();
            
            if (answer.toLowerCase() !== 'y') {
                console.log('Aborted.');
                return;
            }
        }
        
        const deletedFile = await deleteNote(book, parseInt(index));
        console.log(`Deleted note: ${deletedFile}`);
    } catch (e: any) {
        console.error('Error deleting note:', e.message);
    }
  });



program.command('edit')
  .description('Edit a note or a book')
  .argument('<book>', 'The name of the book')
  .argument('[index]', 'The index of the note to edit')
  .option('-c, --content <content>', 'New content for the note')
  .option('-b, --book <book>', 'Move note to this book')
  .option('-n, --name <name>', 'Rename the book')
  .action(async (book, indexStr, options) => {
    try {
        // Book Renaming (No index provided)
        if (!indexStr) {
            if (options.name) {
                await renameBook(book, options.name);
                console.log(`Renamed book "${book}" to "${options.name}".`);
                return;
            } else {
                 console.error('Error: index argument required for note editing, or -n option for book renaming.');
                 process.exit(1);
            }
        }

        // Note Operations (Index provided)
        const index = parseInt(indexStr, 10);
        if (isNaN(index)) {
             console.error('Error: Index must be a number');
             process.exit(1);
        }

        if (options.book) {
            // Move Note
            await moveNote(book, index, options.book);
            console.log(`Moved note ${index} from "${book}" to "${options.book}".`);
            return;
        }

        const note = await getNote(book, index);

        if (options.content) {
            // Update content inline
            await updateNote(book, note.filename, options.content);
             console.log(`Updated note ${index} in book "${book}".`);
             return;
        }

        // Interactive Editor
        const newContent = await openEditor(note.content);

        if (newContent === null) {
            console.log('Note content empty or unchanged, not saving.');
            return;
        }

        if (newContent !== note.content) {
            await updateNote(book, note.filename, newContent);
            console.log(`Updated note ${index} in book "${book}".`);
        } else {
             console.log('No changes made.');
        }

    } catch (e: any) {
        console.error('Error editing:', e.message);
    }
  });

program.command('find')
  .description('Find notes by keywords')
  .argument('[keywords...]', 'Keywords to search for')
  .option('-b, --book <book>', 'book name to find notes in')
  .action(async (keywords, options) => {
    try {
        const keywordString = keywords.join(' ');
        if (!keywordString) {
            console.error('Error: at least one keyword is required');
            process.exit(1);
        }

        const results = await findNotes(keywordString, options.book);
        
        if (results.length === 0) {
            // No results found
            return;
        }

        results.forEach(result => {
             console.log(`${result.book}: ${result.filename}`);
             console.log(result.content.trim()); // Printing content snippet (full content for now as per requirement implied by snippet)
             console.log('');
        });

    } catch (e: any) {
         console.error('Error finding notes:', e.message);
    }
  });



program.command('where')
  .description('Show current database location')
  .action(() => {
    const info = getDbInfo();
    console.log(info.path);
    console.log(`(Source: ${info.source})`);
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

const dbCommand = program.command('database')
  .description('Database operations');

dbCommand.command('rebuild')
  .description('Rebuild the search index from markdown files')
  .action(async () => {
    try {
        console.log('Rebuilding database...');
        await rebuildDB();
    } catch (e: any) {
        console.error('Error rebuilding database:', e.message);
    }
  });

dbCommand.command('check')
  .description('Check database consistency')
  .action(async () => {
      try {
          console.log('Checking database...');
          const result = await checkDB();
          console.log(`Status: ${result.status}`);

          if (result.missingInDB.length > 0) {
              console.log('\nMissing in DB (present on disk):');
              result.missingInDB.forEach(n => console.log(`  - ${n.book}/${n.filename}`));
          }

          if (result.missingOnDisk.length > 0) {
              console.log('\nMissing on Disk (present in DB):');
              result.missingOnDisk.forEach(n => console.log(`  - ${n.book}/${n.filename}`));
          }
      } catch (e: any) {
          console.error('Error checking database:', e.message);
      }
  });

program.parse();
