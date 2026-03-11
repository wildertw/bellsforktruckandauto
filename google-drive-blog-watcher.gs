/**
 * Google Apps Script - Bells Fork Blog Auto-Importer
 *
 * Watches a Google Drive folder for new .docx files and automatically
 * imports them as blog posts via the Netlify blog-docx-import function.
 *
 * SETUP:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into Code.gs
 * 3. Update the CONFIG section below with your values
 * 4. Run setupTrigger() once to start the auto-watch (every 5 minutes)
 * 5. Authorize when prompted
 *
 * HOW IT WORKS:
 * - Every 5 minutes, checks the configured folder for new .docx files
 * - Files not yet processed get downloaded, base64-encoded, and POSTed
 *   to your Netlify blog-docx-import function
 * - Successfully imported files are moved to a "Processed" subfolder
 * - Posts are created as DRAFTS by default (review at /admin/blog)
 *
 * FILENAME CONVENTIONS:
 * - "My Blog Title.docx"                 -> title: "My Blog Title", category: "General"
 * - "[Trucks] My Blog Title.docx"        -> title: "My Blog Title", category: "Trucks"
 * - "[Maintenance] Oil Change Tips.docx"  -> title: "Oil Change Tips", category: "Maintenance"
 */

// ---------------------------------------------------------------
// CONFIG - Update these values
// ---------------------------------------------------------------

var CONFIG = {
  // Your Netlify site URL (no trailing slash)
  SITE_URL: 'https://bellsforkautoandtruck.com',

  // The API key you set as BLOG_IMPORT_API_KEY in Netlify env vars
  API_KEY: 'PASTE_YOUR_API_KEY_HERE',

  // Google Drive folder name to watch (must be exact match)
  FOLDER_NAME: 'BellsForkTruckAndAuto',

  // Default post status: 'draft' or 'published'
  DEFAULT_STATUS: 'draft',

  // Default author name
  DEFAULT_AUTHOR: 'Bells Fork Team'
};

// ---------------------------------------------------------------
// MAIN FUNCTIONS
// ---------------------------------------------------------------

/**
 * Run this ONCE to set up the time-based trigger (every 5 minutes).
 */
function setupTrigger() {
  // Remove any existing triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkForNewDocs') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create new trigger - runs every 5 minutes
  ScriptApp.newTrigger('checkForNewDocs')
      .timeDriven()
      .everyMinutes(5)
      .create();

  Logger.log('Trigger set up. checkForNewDocs will run every 5 minutes.');
}

/**
 * Remove the trigger (stop watching).
 */
function removeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkForNewDocs') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('Trigger removed. Auto-import stopped.');
}

/**
 * Main function - checks the folder for new .docx files and imports them.
 * Called automatically by the time trigger, or run manually to test.
 */
function checkForNewDocs() {
  var folder = findFolder(CONFIG.FOLDER_NAME);
  if (!folder) {
    Logger.log('Folder "' + CONFIG.FOLDER_NAME + '" not found in Google Drive.');
    return;
  }

  // Get or create the "Processed" subfolder
  var processedFolder = getOrCreateSubfolder(folder, 'Processed');

  // Find all .docx files in the folder (not in subfolders)
  var files = folder.getFilesByType(MimeType.MICROSOFT_WORD);
  var count = 0;

  while (files.hasNext()) {
    var file = files.next();
    var filename = file.getName();

    // Skip non-.docx files (extra safety check)
    if (filename.toLowerCase().indexOf('.docx') === -1) continue;

    Logger.log('Found new .docx: ' + filename);

    try {
      var result = importDocxFile(file);
      Logger.log('Import result: ' + JSON.stringify(result));

      // Move file to Processed folder
      file.moveTo(processedFolder);
      Logger.log('Moved "' + filename + '" to Processed folder.');
      count++;
    } catch (err) {
      Logger.log('ERROR importing "' + filename + '": ' + err.message);
      // Don't move the file - it will be retried next run
    }
  }

  if (count === 0) {
    Logger.log('No new .docx files found in "' + CONFIG.FOLDER_NAME + '".');
  } else {
    Logger.log('Imported ' + count + ' blog post(s).');
  }
}

/**
 * Import a single .docx file to the blog.
 */
function importDocxFile(file) {
  var filename = file.getName();
  var blob = file.getBlob();
  var base64 = Utilities.base64Encode(blob.getBytes());

  var payload = {
    file: base64,
    filename: filename,
    status: CONFIG.DEFAULT_STATUS,
    author: CONFIG.DEFAULT_AUTHOR
  };

  var url = CONFIG.SITE_URL + '/.netlify/functions/blog-docx-import';

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-API-Key': CONFIG.API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText());

  if (code !== 200) {
    throw new Error('API returned ' + code + ': ' + (body.error || 'Unknown error'));
  }

  return body;
}

// ---------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------

/**
 * Find a folder by name in Google Drive.
 */
function findFolder(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return null;
}

/**
 * Get or create a subfolder inside a parent folder.
 */
function getOrCreateSubfolder(parent, subName) {
  var subs = parent.getFoldersByName(subName);
  if (subs.hasNext()) {
    return subs.next();
  }
  return parent.createFolder(subName);
}

/**
 * Manual test - run this to test the import with a specific file.
 * Useful for debugging without waiting for the trigger.
 */
function testImport() {
  var folder = findFolder(CONFIG.FOLDER_NAME);
  if (!folder) {
    Logger.log('Folder not found!');
    return;
  }

  var files = folder.getFilesByType(MimeType.MICROSOFT_WORD);
  if (!files.hasNext()) {
    Logger.log('No .docx files in folder.');
    return;
  }

  var file = files.next();
  Logger.log('Testing with: ' + file.getName());

  try {
    var result = importDocxFile(file);
    Logger.log('SUCCESS: ' + JSON.stringify(result, null, 2));
  } catch (err) {
    Logger.log('ERROR: ' + err.message);
  }
}
