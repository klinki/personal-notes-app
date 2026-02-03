import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { addNote, getNotes, getBooksRecursive, setDbLocation, deleteNote, findNotes, getDbInfo, getNote, updateNote, moveNote, renameBook, rebuildDB, checkDB, getTemplates, applyTemplate } from './store';
import { openEditor } from './editor';
import { getConfig, setConfig } from './config';
import { syncNotes, autoSync } from './commands/sync';
import { runDaemon } from './commands/daemon';
import { installService, uninstallService } from './commands/service';
import { reindexNotes } from './commands/index_cmd';

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
  .option('--title <title>', 'The title of the note')
  .option('-t, --template <name>', 'Use a template')
  .option('--tags <tags>', 'Comma separated tags')
  .action(async (book, content, options) => {
    try {
      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined;

      if (content) {
        await addNote(book, content, { title: options.title, template: options.template, tags });
      } else {
        let initialContent = '';
        if (options.template) {
          initialContent = await applyTemplate(options.template);
        }

        const editorContent = await openEditor(initialContent);
        if (editorContent) {
          // If we used a template, it's already in editorContent.
          // We pass tags, but NOT template again.
          await addNote(book, editorContent, { title: options.title, tags });
        } else {
          console.log('Empty note, not saved.');
          return;
        }
      }
      await autoSync();
    } catch (e: any) {
      console.error('Error adding note:', e.message);
    }
  });

program.command('templates')
  .description('List available templates')
  .action(async () => {
    const templates = await getTemplates();
    if (templates.length === 0) {
      console.log('No templates found.');
    } else {
      templates.forEach(t => console.log(t));
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
      await autoSync();
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
          await autoSync();
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
        await autoSync();
        return;
      }

      const note = await getNote(book, index);

      if (options.content) {
        // Update content inline
        if (!note.filename) throw new Error('Note filename missing');
        await updateNote(book, note.filename, options.content);
        console.log(`Updated note ${index} in book "${book}".`);
        await autoSync();
        return;
      }

      // Interactive Editor
      const newContent = await openEditor(note.content);

      if (newContent === null) {
        console.log('Note content empty or unchanged, not saving.');
        return;
      }

      if (newContent !== note.content) {
        if (!note.filename) throw new Error('Note filename missing');
        await updateNote(book, note.filename, newContent);
        console.log(`Updated note ${index} in book "${book}".`);
        await autoSync();
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
  .option('--tag <tag>', 'Filter by tag')
  .action(async (keywords, options) => {
    try {
      const keywordString = keywords.join(' ');
      if (!keywordString && !options.tag) {
        console.error('Error: at least one keyword or tag is required');
        process.exit(1);
      }

      const results = await findNotes(keywordString, options.book, options.tag);

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

program.command('sync')
  .description('Sync notes with remote repository')
  .action(async () => {
    await syncNotes();
  });

// --- Background Sync Commands ---

program.command('daemon')
  .description('Run the sync daemon (foreground)')
  .option('-i, --interval <seconds>', 'Sync interval in seconds', '60')
  .action(async (options) => {
    const interval = parseInt(options.interval, 10);
    await runDaemon(interval);
  });

const serviceCommand = program.command('service')
  .description('Manage background service');

serviceCommand.command('install')
  .description('Install mnote background service')
  .option('-i, --interval <seconds>', 'Sync interval in seconds', '60')
  .action(async (options) => {
    const interval = parseInt(options.interval, 10);
    await installService(interval);
  });

serviceCommand.command('uninstall')
  .description('Uninstall mnote background service')
  .action(async () => {
    await uninstallService();
  });


const configCommand = program.command('config')
  .description('Configuration operations');

configCommand.command('get')
  .description('Get a configuration value')
  .argument('<key>', 'The configuration key')
  .action(async (key) => {
    try {
      const value = await getConfig(key);
      console.log(JSON.stringify(value, null, 2));
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });

configCommand.command('set')
  .description('Set a configuration value')
  .argument('<key>', 'The configuration key')
  .argument('<value>', 'The value to set')
  .action(async (key, value) => {
    try {
      await setConfig(key, value);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });

program.command('reindex')
  .description('Regenerate README.md and INDEX.md files')
  .action(async () => {
    await reindexNotes();
  });

program.parse();
