# Amnesia Live Testing Guide

This guide covers how to run live integration tests against a real Calibre Content Server.

## Prerequisites

- **Calibre** installed (`/Applications/calibre.app` on macOS)
- **Node.js** 18+ with npm
- A Calibre library with some books (even 10-20 is fine for basic testing)

## Starting Calibre Content Server

### Option 1: From Terminal (Recommended for Testing)

```bash
# Start server on port 8080 with your library
/Applications/calibre.app/Contents/MacOS/calibre-server \
  --port 8080 \
  --enable-local-write \
  "/path/to/your/Calibre Library"

# Example with a specific library:
/Applications/calibre.app/Contents/MacOS/calibre-server \
  --port 8080 \
  --enable-local-write \
  ~/Documents/Calibre\ Library
```

**Common Options:**
- `--port 8080` - Port to listen on (default: 8080)
- `--enable-local-write` - Allow write operations (needed for bidirectional sync)
- `--username admin --password secret` - Enable authentication
- `--log /tmp/calibre-server.log` - Log to file

### Option 2: From Calibre GUI

1. Open Calibre
2. Go to **Preferences** → **Sharing over the net**
3. Check **Run server automatically when Calibre starts**
4. Set port to `8080`
5. Click **Start server**

### Option 3: Background Service

```bash
# Run in background
nohup /Applications/calibre.app/Contents/MacOS/calibre-server \
  --port 8080 \
  ~/Documents/Calibre\ Library \
  > /tmp/calibre-server.log 2>&1 &

# Check if running
curl -s http://localhost:8080/ajax/library-info | jq
```

## Verifying Server is Running

```bash
# Quick health check
curl http://localhost:8080/

# Get library info (JSON)
curl http://localhost:8080/ajax/library-info

# List books (first 10)
curl "http://localhost:8080/ajax/books?num=10"
```

Expected response from `/ajax/library-info`:
```json
{
  "library_map": {
    "Calibre_Library": "/path/to/library"
  },
  "default_library": "Calibre_Library"
}
```

## Environment Variables

Set these before running tests:

```bash
export CALIBRE_SERVER_URL="http://localhost:8080"
export CALIBRE_USERNAME=""  # Leave empty if no auth
export CALIBRE_PASSWORD=""  # Leave empty if no auth
export CALIBRE_LIBRARY="Calibre_Library"  # Library name from library-info
```

## Running Tests

### From Obsidian DevTools

Connect to Obsidian and run the standalone test runner:

```javascript
// Connect first
mcp__obsidian-devtools__obsidian_connect()

// Run Calibre live tests
(async function() {
  const plugin = app.plugins.plugins['amnesia'];

  // Import test runner
  const { runCalibreLiveTests } = await import(
    plugin.manifest.dir + '/test/integration/calibre-live.test.js'
  );

  // Get calibre client and sync engine
  const client = plugin.calibreClient;
  const syncEngine = plugin.syncEngine;

  // Run tests
  const results = await runCalibreLiveTests(client, syncEngine);
  console.table(results);

  return results;
})();
```

### Manual Testing in Console

```javascript
// Test connection
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const connected = await plugin.calibreClient?.testConnection();
  console.log('Connected:', connected);
})();

// Test book fetch
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const books = await plugin.calibreClient?.getBooks();
  console.log('Books:', books?.length);
  if (books?.length > 0) {
    console.log('First book:', books[0].title);
  }
})();

// Test full sync
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const result = await plugin.syncEngine?.sync({ mode: 'full' });
  console.log('Sync result:', result);
})();
```

## Test Scenarios

### 1. Basic Connection Test
- Start Calibre server
- Open Obsidian with Amnesia plugin
- Go to plugin settings, enter server URL
- Click "Test Connection"

### 2. Full Sync Test
- Run command: "Amnesia: Sync Library"
- Observe progress modal
- Verify book notes are created in Florilegios folder

### 3. Incremental Sync Test
- Run full sync first
- Modify a book in Calibre (change rating, add tag)
- Run sync again
- Verify only changed book is updated

### 4. Conflict Resolution Test
- Sync a book
- Modify rating in both Obsidian note AND Calibre
- Run sync
- Observe conflict modal appears
- Choose resolution strategy

### 5. Resume Test
- Start a large sync
- Close Obsidian mid-sync
- Reopen Obsidian
- Observe resume toast notification
- Click "Resume" and verify continuation

## Creating a Test Library

For consistent testing, create a dedicated test library:

```bash
# Create empty library
mkdir ~/CalibreTestLibrary

# Add some test EPUBs
calibredb add ~/Downloads/*.epub --library-path ~/CalibreTestLibrary

# Set some metadata
calibredb set_metadata 1 --field rating:5 --library-path ~/CalibreTestLibrary
calibredb set_metadata 2 --field tags:"fiction,classic" --library-path ~/CalibreTestLibrary

# Start server with test library
/Applications/calibre.app/Contents/MacOS/calibre-server \
  --port 8080 \
  ~/CalibreTestLibrary
```

## Troubleshooting

### Server not responding
```bash
# Check if port is in use
lsof -i :8080

# Kill existing process
kill $(lsof -t -i :8080)
```

### Authentication errors
- Verify username/password in plugin settings
- Try without authentication first
- Check server logs: `--log /tmp/calibre-server.log`

### CORS issues
The Calibre server should work without CORS issues when accessed from Obsidian (which runs in Electron). If testing from a browser, start server with:
```bash
calibre-server --cors-origin "*" ...
```

### Slow performance
- Check network between Obsidian and Calibre server
- Try reducing batch size in sync settings
- Monitor server CPU usage

## Performance Benchmarks

Target performance (based on PRD):

| Scenario | Target |
|----------|--------|
| 100 books full sync | < 10 seconds |
| 1000 books full sync | < 60 seconds |
| 5000 books full sync | < 3 minutes |
| 50 books incremental | < 30 seconds |
| Cover download (5 parallel) | 5x faster than sequential |

## Next Steps

After basic tests pass:
1. Run full benchmark suite
2. Test with your actual library
3. Verify data integrity (spot check book notes)
4. Test edge cases (Unicode titles, missing covers, etc.)
