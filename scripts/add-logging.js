#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'electron', 'main.cjs');
let content = fs.readFileSync(filePath, 'utf-8');

// List of IPC handlers to add logging to
const handlers = [
  'uc:setting-get',
  'uc:setting-set',
  'uc:auth-login',
  'uc:download-start',
  'uc:download-cancel',
  'uc:download-pause',
  'uc:download-resume',
  'uc:download-resume-interrupted',
  'uc:download-show',
  'uc:download-open',
  'uc:disk-list',
  'uc:download-path-get',
  'uc:download-path-set',
  'uc:download-path-pick',
  'uc:download-usage',
  'uc:installed-list',
  'uc:installed-get',
  'uc:installed-list-global',
  'uc:installed-get-global',
  'uc:installing-list',
  'uc:installing-get',
  'uc:installing-list-global',
  'uc:installing-get-global',
  'uc:game-exe-list',
  'uc:game-exe-launch',
  'uc:game-exe-running',
  'uc:game-exe-quit',
  'uc:installed-delete',
  'uc:installing-delete',
];

handlers.forEach(handler => {
  const pattern = `ipcMain.handle('${handler}'`;
  const logMessage = `ucLog('IPC: ${handler}')`;
  
  // Replace pattern to add logging right after the handler definition
  content = content.replace(
    pattern,
    `${pattern}\n  ${logMessage}`
  );
});

// Add logging to catch blocks
content = content.replace(/} catch \(err\) {/g, `} catch (err) {\n    ucLog('Error: ' + err.message, 'error')`);

fs.writeFileSync(filePath, content);
console.log('✓ Logging added to main.cjs');
