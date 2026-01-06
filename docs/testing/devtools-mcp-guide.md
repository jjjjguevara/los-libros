# Obsidian DevTools MCP Guide for Amnesia

This guide covers using the Obsidian DevTools MCP server to inspect and debug the Amnesia sync system.

## Setup

The DevTools MCP server should be configured in Claude Code. It allows direct interaction with Obsidian.

## Connecting

```javascript
// Always connect first
mcp__obsidian-devtools__obsidian_connect()

// Verify connection
mcp__obsidian-devtools__obsidian_get_vault_info()
```

## Accessing Amnesia Plugin

```javascript
// Get plugin instance
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  return {
    loaded: !!plugin,
    version: plugin?.manifest?.version,
    hasyncEngine: !!plugin?.syncEngine,
    hasCalibreClient: !!plugin?.calibreClient,
  };
})();
```

## Sync Engine Inspection

### Check Sync Status

```javascript
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const engine = plugin?.syncEngine;

  if (!engine) return { error: 'Sync engine not initialized' };

  return {
    status: engine.getStatus(),
    hasResumable: engine.hasResumableSync?.(),
    currentSession: engine.getCurrentSession(),
  };
})();
```

### Monitor Progress in Real-Time

```javascript
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const engine = plugin?.syncEngine;

  if (!engine) return 'No sync engine';

  engine.on('progress', (p) => {
    console.log(`Sync: ${p.percentage}% - ${p.phase} (${p.processed}/${p.total})`);
  });

  engine.on('error', (e) => {
    console.error('Sync error:', e.error.message);
  });

  engine.on('complete', (data) => {
    console.log('Sync complete!', data.session);
  });

  return 'Monitoring started - check console';
})();
```

### Trigger Sync

```javascript
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const result = await plugin.syncEngine?.sync({
    mode: 'incremental',  // or 'full'
    dryRun: false,
  });
  return result;
})();
```

## Calibre Client Inspection

### Test Connection

```javascript
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const client = plugin?.calibreClient;

  if (!client) return { error: 'No Calibre client' };

  const connected = await client.testConnection();
  return { connected };
})();
```

### Fetch Books

```javascript
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const books = await plugin.calibreClient?.getBooks();

  return {
    count: books?.length || 0,
    sample: books?.slice(0, 3).map(b => ({
      id: b.id,
      title: b.title,
      authors: b.authors,
    })),
  };
})();
```

## Conflict Resolution Inspection

### Check Pending Conflicts

```javascript
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const manager = plugin?.conflictManager;

  if (!manager) return { error: 'No conflict manager' };

  return {
    pending: manager.getPendingCount(),
    resolved: manager.getResolvedConflicts().length,
    stats: manager.getStats(),
  };
})();
```

### View Conflict Details

```javascript
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const conflicts = plugin?.conflictManager?.getPendingConflicts();

  return conflicts?.map(c => ({
    id: c.id,
    field: c.field,
    entityType: c.entityType,
    local: c.localValue,
    remote: c.remoteValue,
  }));
})();
```

## Checkpoint Inspection

### Check for Resumable Sync

```javascript
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const checkpointManager = plugin?.syncEngine?.checkpointManager;

  if (!checkpointManager) return { error: 'No checkpoint manager' };

  const hasResumable = await checkpointManager.hasResumableSync();
  const incomplete = hasResumable
    ? await checkpointManager.getIncompleteSync()
    : null;

  return {
    hasResumable,
    checkpoint: incomplete?.checkpoint,
  };
})();
```

## Screenshots

### Capture Current State

```javascript
mcp__obsidian-devtools__obsidian_capture_screenshot({ format: 'png' })
```

### Capture After Action

```javascript
// Trigger sync then capture
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  plugin.syncEngine?.sync({ mode: 'incremental' });
})();

// Wait 2 seconds for modal to appear
await new Promise(r => setTimeout(r, 2000));

// Capture
mcp__obsidian-devtools__obsidian_capture_screenshot({ format: 'png' });
```

## Console Logs

### Get Recent Errors

```javascript
mcp__obsidian-devtools__obsidian_get_console_logs({ level: 'error', limit: 20 })
```

### Get All Logs

```javascript
mcp__obsidian-devtools__obsidian_get_console_logs({ level: 'all', limit: 100 })
```

### Filter Sync-Related Logs

```javascript
(function() {
  const logs = [];
  const originalLog = console.log;

  console.log = (...args) => {
    if (args.some(a => String(a).includes('sync') || String(a).includes('Sync'))) {
      logs.push(args);
    }
    originalLog.apply(console, args);
  };

  return 'Sync logging enabled - call getSyncLogs() to retrieve';
})();
```

## Plugin Reload

```javascript
mcp__obsidian-devtools__obsidian_reload_plugin({ pluginId: 'amnesia' })
```

## Debugging Tips

### 1. Slow Sync Investigation

```javascript
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  const engine = plugin?.syncEngine;

  let lastTime = Date.now();
  engine?.on('progress', (p) => {
    const now = Date.now();
    const delta = now - lastTime;
    lastTime = now;

    if (delta > 1000) {
      console.warn(`Slow item: ${p.currentItem} took ${delta}ms`);
    }
  });

  return 'Slow item detection enabled';
})();
```

### 2. Memory Usage

```javascript
(function() {
  if (performance.memory) {
    return {
      usedJSHeapSize: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
      totalJSHeapSize: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
    };
  }
  return 'Memory API not available';
})();
```

### 3. Network Timing

```javascript
(async function() {
  const plugin = app.plugins.plugins['amnesia'];
  const client = plugin?.calibreClient;

  const start = performance.now();
  await client?.testConnection();
  const duration = performance.now() - start;

  return { connectionTime: `${duration.toFixed(2)}ms` };
})();
```

## Common Issues

### Plugin Not Found
- Ensure plugin is installed and enabled
- Check plugin ID is exactly 'amnesia'

### Sync Engine Null
- Plugin may not be fully initialized
- Wait a moment after Obsidian starts
- Check for errors in console

### Connection Refused
- Verify Calibre server is running
- Check server URL in plugin settings
- Test with curl: `curl http://localhost:8080/`
