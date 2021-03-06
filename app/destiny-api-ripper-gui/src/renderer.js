require('dotenv').config({ path: 'api.env' });

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ipcRenderer } = require('electron');
// const os = require('os');

const defaultPreferences = {
    "outputPath": {
        value: null,
        defaultValue: '',
        ifUndefined: (key) => {
            let defaultPath = path.join(process.cwd(), 'output');
            try {
                fs.mkdirSync(defaultPath);
            } catch (error) {
                // Let the error go wild and free
            }
            userPreferences[key].value = defaultPath;
        }
    },
    "toolPath": {
        value: null,
        defaultValue: '',
        ifUndefined: () => {
            alert('Please select your Destiny Collada Generator executable. Must be at least version 1.5.1.');
            ipcRenderer.send('selectToolPath');
        }
    },
    "locale": {
        value: null,
        defaultValue: "EN",
        ifUndefined: (key) => {
            userPreferences[key].value = userPreferences[key].defaultValue;
        }
    },
    "aggregateOutput": {
        value: null,
        defaultValue: true,
        ifUndefined: (key) => {
            userPreferences[key].value = userPreferences[key].defaultValue;
        }
    }
};

let itemContainer = $('#item-container');
let queue = $('#extract-queue');

let userPreferences;
try {
    userPreferences = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'user_preferences.json'), 'utf-8'));
} catch (error) {
    // default preferences
    userPreferences = defaultPreferences;
    for (const [key, property] of Object.entries(userPreferences)) {
        property.ifUndefined(key);

    }
    propogateUserPreferences();
    // fs.writeFileSync(path.join(process.cwd(), 'user_preferences.json'), JSON.stringify(userPreferences), 'utf8');
}

let destiny1ItemDefinitions = {};
let destiny2ItemDefinitions = {};
let searchDebounceTimeout;
let selectedItems = [];

const baseUrl = 'https://bungie.net';
const apiRoot = baseUrl + '/Platform';

function itemFilter(item) {
    let testTypeDisplayName = (item.itemTypeDisplayName ? item.itemTypeDisplayName : '');
    if (testTypeDisplayName.includes('Defaults')) { return false }
    if (testTypeDisplayName.includes('Glow')) { return false }
    if ([2, 21, 22, 24].includes(item.itemType)) { return true }
    if (item.defaultDamageType > 0) { return true }
    if (item.itemType === 19 && [20, 21].includes(item.itemSubType)) { return true }
}

function getDestiny2ItemDefinitions(callback) {
    axios.get(apiRoot + '/Destiny2/Manifest/', { headers: { 'X-API-Key': process.env.API_KEY } })
        .then((res) => {
            axios.get(baseUrl + res.data.Response.jsonWorldComponentContentPaths[userPreferences.locale.value.toLowerCase()].DestinyInventoryItemDefinition)
                .then((res) => {
                    for (let [hash, item] of Object.entries(res.data)) {
                        if (itemFilter(item)) {
                            destiny2ItemDefinitions[hash] = item;
                        }
                    }
                    sortItemDefinitions(callback);
                });
        });
}

function sortItemDefinitions(callback) {
    let items = [...Object.values(destiny2ItemDefinitions)].sort((a, b) => { return a.index - b.index });
    destiny2ItemDefinitions = new Map();
    items.forEach((item) => {
        destiny2ItemDefinitions.set(item.hash, item);
    });
    callback();
}

// function that finds the closest value in a list of numbers
function closest(searchTarget, targetList) {
    return targetList.reduce((prev, curr) => {
        return (Math.abs(curr - searchTarget) < Math.abs(prev - searchTarget) ? curr : prev);
    });
}

function createItemTile(item, game) {
    let tileRoot = $('<div></div>', {
        class: 'item-tile d-flex align-items-center p-1',
        style: 'position: relative;',
        id: item.hash,
        'data-index': item.index,
        name: (item.displayProperties.name ? item.displayProperties.name : 'Classified'),
        on: {
            click: itemTileClickHandler
        }
    });

    // Image div (Icon & Season Badge)
    let imgDiv = $('<div></div>', {
        style: 'display: grid; position: relative;'
    });

    imgDiv.append($('<img></img>', {
        src: `https://bungie.net${item.displayProperties.icon}`,
        referrerpolicy: 'no-referrer',
        crossorigin: 'None',
        loading: 'lazy',
        style: 'grid-row: 1; grid-column: 1;'
    }));

    if (item.iconWatermark) {
        imgDiv.append($('<img></img>', {
            src: `https://bungie.net${item.iconWatermark}`,
            referrerpolicy: 'no-referrer',
            crossorigin: 'None',
            loading: 'lazy',
            style: 'grid-row: 1; grid-column: 1; z-index: 1;'
        }));
    }

    // Item text (Name & Type)
    let textDiv = $('<div></div>', {
        class: 'tile-text d-inline-flex px-2'
    });

    let textContainer = $('<div></div>', {});
    textContainer.append($(`<h6></h6>`, {
        text: (item.displayProperties.name ? item.displayProperties.name : undefined),
        class: 'm-0',
        style: `color: var(--${item.inventory.tierTypeName.toLowerCase()}-color)`
    }));
    textContainer.append($('<i></i>', {
        text: (item.itemTypeDisplayName ? item.itemTypeDisplayName : undefined),
        class: 'fs-5 item-type',
        // style: 'font-size: 110%'
    }));

    textDiv.append(textContainer);
    tileRoot.append(imgDiv);
    tileRoot.append(textDiv);

    return tileRoot;
}

function addItemToContainer(item) {
    let containerContents = [...itemContainer.eq(0).children()].map(item => { return item.dataset.index });
    if (item.data('index') < Math.min(...containerContents)) {
        $(`[data-index='${closest(item.data('index'), containerContents)}']`).before(item);
    } else {
        $(`[data-index='${closest(item.data('index'), containerContents)}']`).after(item);
    }
}

function clearQueue() {
    [...queue.eq(0).children()].forEach(item => { addItemToContainer($(`#${item.id}`).detach()); });
}

function itemTileClickHandler(event) {
    let tileLocation = $(event.currentTarget).eq(0).parents().attr('id');
    if (tileLocation === 'item-container') {
        queue.append($(event.currentTarget).detach());
    } else if (tileLocation === 'extract-queue') {
        addItemToContainer($(event.currentTarget).detach());
    }
}

function setVisibility(jqueryObj, state) {
    // true -> visible
    // false -> hidden
    jqueryObj.removeClass((state ? 'hidden' : 'p-1')).addClass((state ? 'p-1' : 'hidden'))
}

function searchBoxUpdate(event) {
    clearTimeout(searchDebounceTimeout);

    searchDebounceTimeout = setTimeout(() => {
        if (event.target.value) {
            itemContainer.eq(0).children().each((_, element) => {
                let item = $(`#${element.id}`)
                if (item.attr('name').toLowerCase().includes(event.target.value.toLowerCase())) {
                    setVisibility(item, true);
                } else {
                    setVisibility(item, false);
                }
            });
        } else {
            itemContainer.eq(0).children().each((_, element) => {
                setVisibility($(`#${element.id}`), true);
            });
        }
    }, 500);
}

function loadItems() {
    itemContainer.empty();
    queue.empty();
    console.log(`${destiny2ItemDefinitions.size} items indexed.`)
    destiny2ItemDefinitions.forEach((item) => {
        itemContainer.append(createItemTile(item, 2));
    })
    console.log(`${destiny2ItemDefinitions.size} items loaded.`)
}

function runTool(hashes) {
    let commandArgs = ['2', '-o', userPreferences.outputPath.value].concat(hashes);
    let child = execFile(userPreferences.toolPath.value, commandArgs, (err, stdout, stderr) => {
        if (err) {
            throw err;
        }
    });
    child.stdout.on('data', (data) => { console.log(`stdout: ${data}`) });
    child.stderr.on('data', (data) => { console.log(`stderr: ${data}`) });

    return child;
}

function runToolRecursive(itemHashes) {
    if (itemHashes.length > 0) {
        let child = runTool([itemHashes.pop()]);
        child.on('exit', (code) => { runToolRecursive(itemHashes) });
    } else {
        setVisibility($('#loading-indicator'), false);
        $('#queue-execute-button').removeAttr('disabled');
    }
}

function executeQueue() {
    if (navigator.onLine) {
        // DestinyColladaGenerator.exe [<GAME>] [-o <OUTPUTPATH>] [<HASHES>]
        let itemHashes = [...queue.eq(0).children()].map(item => { return item.id });
        console.log(`Hashes: ${itemHashes}`);

        // change DOM to reflect program state
        setVisibility($('#loading-indicator'), true);
        $('#queue-execute-button').attr('disabled', 'disabled');

        if (userPreferences.aggregateOutput.value) {
            let child = runTool(itemHashes);
            child.on('exit', (code) => {
                setVisibility($('#loading-indicator'), false);
                $('#queue-execute-button').removeAttr('disabled');
            });
        } else {
            runToolRecursive(itemHashes);
        }
    } else {
        console.log('No internet connection detected');
    }
}

function updateUIInput(elementId, value) {
    switch (typeof value) {
        case 'string':
            $(`#${elementId}`).val(value);
            break;

        case 'boolean':
            $(`#${elementId}`).prop('checked', !!value);
            break;

        default:
            break;
    }
}

function propogateUserPreferences(key) {
    if (key) {
        updateUIInput(key, userPreferences[key].value);
    } else {
        for (const [key, property] of Object.entries(userPreferences)) {
            updateUIInput(key, property.value);
        }
    }
    fs.writeFileSync(path.join(process.cwd(), 'user_preferences.json'), JSON.stringify(userPreferences), 'utf8');
}

function updateUserPreference(key, value) {
    if (userPreferences[key].value !== value) {
        userPreferences[key].value = value;
        propogateUserPreferences(key);
    }
}

function notImplemented() {
    alert('This feature has not been implemented yet.');
}

window.addEventListener('DOMContentLoaded', (event) => {
    getDestiny2ItemDefinitions(loadItems);
    propogateUserPreferences()
});

// Features implemented in this file
document.getElementById('queue-clear-button').addEventListener('click', clearQueue);
document.getElementById('queue-execute-button').addEventListener('click', executeQueue);
document.getElementById('search-box').addEventListener('input', searchBoxUpdate);
document.getElementById('aggregateOutput').addEventListener('input', () => { updateUserPreference('aggregateOutput', document.getElementById('aggregateOutput').checked) });

// Features implemented using IPCs
document.getElementById('outputPath').addEventListener('click', () => { ipcRenderer.send('selectOutputPath') });
document.getElementById('toolPath').addEventListener('click', () => { ipcRenderer.send('selectToolPath') });
document.getElementById('open-output').addEventListener('click', () => { ipcRenderer.send('openExplorer', [userPreferences.outputPath.value]) })

ipcRenderer.on('selectOutputPath-reply', (_, args) => {
    if (args) {
        updateUserPreference('outputPath', args[0]);
    }
});

ipcRenderer.on('selectToolPath-reply', (_, args) => {
    if (args) {
        updateUserPreference('toolPath', args[0]);
    }
});

ipcRenderer.on('reload', (_, args) => {
    if (args) {
        loadItems();
    }
});

ipcRenderer.on('force-reload', (_, args) => {
    if (args) {
        document.location.reload();
    }
});

// Not implemented
document.getElementById('sort-rules-button').addEventListener('click', notImplemented);
document.getElementById('filter-button').addEventListener('click', notImplemented);
