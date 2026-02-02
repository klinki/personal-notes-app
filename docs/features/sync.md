# Synchronization Implementation Plan

## Objective
Implement a synchronization mechanism for `mnote` to allow users to keep their notes consistent across multiple machines. The primary candidate for this is **Git**, given the text-based nature (Markdown) of the data.

## 1. The Git Approach (Proposed)
Since `mnote` stores notes as Markdown files in a directory, Git is a natural fit.

### How it would work
We would implement a new command `mnote sync`.

**Workflow:**
1.  **Check Status**: Check if there are local changes.
2.  **Stage & Commit**: If changes exist, `git add .` and `git commit` with a timestamped message (e.g., "Sync: 2026-02-02 10:00").
3.  **Pull (Rebase)**: `git pull --rebase origin master` to fetch remote changes and replay local changes on top. flattening the history.
4.  **Push**: `git push origin master` to upload changes.

### Pros
-   **Version Control**: precise history of every change. You can undo anything.
-   **Conflict Resolution**: Git is the gold standard for text merging.
-   **Infrastructure**: Users can use GitHub, GitLab, Bitbucket, or any private SSH server. No vendor lock-in.
-   **Offline First**: Works perfectly offline; syncs when connected.
-   **Efficiency**: Only transfers deltas (changes), not full files.

### Cons
-   **Merge Conflicts**: If the same line is modified on two devices, the user might see conflict markers (`<<<<<<<`). We need a strategy to handle this (e.g., abort and ask user to fix, or auto-accept local/remote).
-   **Binary Dependencies**: Requires `git` to be installed and available in `$PATH`.
-   **Authentication**: Managing SSH keys or HTTP credentials can be tricky for CLI tools without a UI.

---

## 2. Alternatives Considered

### A. Cloud Drive (Dropbox, Google Drive, OneDrive)
-   **How**: User simply places their `$MNOTE_HOME` inside their Dropbox folder.
-   **Pros**: Zero code required.
-   **Cons**: "Last write wins" conflicts. No true merge capability. If two computers edit the same file, you get "Conflicted Copy" files synced.

### B. Object Storage (S3 / R2)
-   **How**: `mnote` uploads/downloads files to an S3 bucket.
-   **Pros**: Cheap, simple API.
-   **Cons**: No diffing. Re-inventing the wheel for syncing protocols. High bandwidth if syncing many small files without smart checking.

### C. Mutagen / Syncthing / Rsync
-   **How**: Running a background daemon to watch and sync files.
-   **Pros**: Real-time.
-   **Cons**: Complex to set up and monitor. `rsync` is one-way or requires strict discipline.

---

## 3. Detailed Design: Git Sync Implementation

I recommend proceeding with the **Git Approach** as it aligns best with the "developer tool" philosophy of a CLI notes app.

### New Command: `mnote sync`

#### Configuration
We need to store sync settings, likely in a config file or simply rely on the `.git` folder existing in `MNOTE_HOME`.
-   **Assumpton**: The user initializes the repo themselves (`git init`, `git remote add`).
-   **Or**: `mnote init-sync <url>` helper.

#### The Sync Logic (Pseudocode)
```typescript
async function sync() {
  const git = simpleGit(MNOTE_HOME);

  // 1. Commit local changes
  const status = await git.status();
  if (status.files.length > 0) {
    await git.add('.');
    await git.commit(`Sync: ${new Date().toISOString()}`);
  }

  // 2. Pull
  try {
    await git.pull('origin', 'master', {'--rebase': 'true'});
  } catch (e) {
    if (e.message.includes('CONFLICT')) {
       console.error("Conflict detected! Please resolve conflicts in", MNOTE_HOME, "and commit.");
       process.exit(1);
    }
  }

  // 3. Push
  await git.push('origin', 'master');
}
```

#### Handling Conflicts
-   **Strategy**: "Stop and Notify".
-   If a rebase conflict occurs, `mnote` should stop and tell the user: *"Sync conflict. Go to your notes directory and resolve git conflicts manually, then run sync again."*
-   Trying to auto-resolve conflicts in a CLI is dangerous and prone to data loss.

### Future Enhancements
-   **Auto-Sync**: Run sync on `mnote` exit or via a background cron/task.
-   `.gitignore`: Automatically manage a `.gitignore` in the notes dir to ignore temp files.

## Recommendation
**Start with a manual `mnote sync` command wrapper around Git.**
It is simple, robust, and gives the user full control.

### Next Steps (if approved)
1.  Add `simple-git` dependency (wrapper for running git commands).
2.  Implement `sync` command.
3.  Add `init-sync` command to help setup the remote.

## 4. Autosync (Planned)
- **Configuration**: New boolean key `autosync` (default: `false`).
- **Triggers**: `add`, `edit`, `delete` commands.
- **Behavior**: If enabled, runs `sync()` after successful operation. Errors in sync are logged but don't fail the operation.

## 5. Background Synchronization (Proposed)

To ensure notes are always up-to-date without manual intervention, especially when editing files directly via editor, we need a background synchronization mechanism.

### Option A: Built-in Daemon (`mnote daemon`)
Implement a command that runs indefinitely and syncs periodically.
- **Pros**:
    -   Cross-platform logic (TypeScript/Bun).
    -   Simple to implement (`setInterval` + `syncNotes`).
    -   No external dependencies or admin rights needed to *run*.
- **Cons**:
    -   User must keep the terminal open or use a process manager (like `tmux` or `systemd`) to keep it running.
    -   Does not auto-start on boot unless configured externally.

### Option B: Native OS Services
Register `mnote` as a system service.
- **Linux**: Systemd user service (`~/.config/systemd/user/mnote-sync.service`).
- **macOS**: Launchd agent (`~/Library/LaunchAgents/com.mnote.sync.plist`).
- **Windows**: Windows Service or Scheduled Task.
- **Pros**:
    -   "Set and forget".
    -   Auto-starts on boot.
    -   Resilient (OS restarts it if it crashes).
- **Cons**:
    -   Complex installation (requires generating platform-specific config files).
    -   Harder to debug for the user.

### Option C: Cron / Task Scheduler
Run the existing `mnote sync` command periodically via OS scheduler.
- **Linux/macOS**: `crontab -e` (`*/5 * * * * mnote sync`).
- **Windows**: Task Scheduler.
- **Pros**:
    -   Efficient (not a long-running process).
    -   Uses existing OS tools.
- **Cons**:
    -   High friction to set up for non-technical users.
    -   Latency (syncs only every X minutes).

### Recommendation
**Hybrid Approach**:
1.  Implement `mnote daemon` (Option A) as the core logic.
    -   Accepts `--interval <seconds>`.
2.  Provide a helper command `mnote service install` (Option B) that generates/registers the OS-specific configuration to run `mnote daemon` in the background.
    -   This gives the best of both worlds: simple logic + robust system integration.

## 6. Concurrency Control (Locking)
To prevent conflicts between manual `mnote sync`, `autosync`, and the background daemon, we must implement a **Locking Mechanism**.

### Strategy: File System Lock
1.  **Lock File**: `.mnote-sync.lock` in the notes directory.
2.  **Acquire**:
    -   Before any sync operation (manual or background), try to create this file.
    -   Write the current Process ID (PID) and timestamp into it.
    -   If file exists:
        -   Check if PID is still running (stale lock check). (Or simply check file age > 5 mins).
        -   **Background Sync**: If locked, **SKIP** this run. Do not wait. Return immediately.
        -   **Manual/Auto Sync**: Wait for X seconds (e.g., 5s), then fail if still locked with a "Sync in progress" message.
3.  **Release**:
    -   Delete the file upon success or error.
    -   Use `finally` block to ensure cleanup.

This ensures that `background sync` never interrupts a user editing session or a manual sync, and vice versa.
