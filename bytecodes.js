'use strict';
const fs = require('fs');
const util = require('util');
let path = 'artifacts/contracts';

const readDirectories = util.promisify(fs.readdir);

async function getAllAvailableFiles(dir, files_, names_){
  var files = await readDirectories(dir);
  for (var i in files){
      var fullDir = dir + '/' + files[i];
      if (fs.statSync(fullDir).isDirectory()){
          await getAllAvailableFiles(fullDir, files_, names_);
      } else {
          files_.push(fullDir);
          names_.push(files[i]);
      }
  }
  return (files_, names_);
}


async function createByteCodeData() {
  let result = {};
  let directories = [];
  let files = [];
  await getAllAvailableFiles(path, directories, files);

  for (let i = 0; i < directories.length; i++) {
    let dir = directories[i];
    let data = fs.readFileSync(dir);
    let contractData = JSON.parse(data);
    if (contractData.deployedBytecode != undefined) {
      let bytecode = contractData.deployedBytecode.length / 2 - 1;
      if (bytecode > 0) {
        result[files[i]] = bytecode;
      }
    }
  }
  return result;
}

async function writeData(bytecodes) {
  let content = JSON.stringify(bytecodes, null, '\t');
  let dir = `bytecodes/`;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
  let file = `${dir}bytecodes.json`;
  fs.writeFile(file, content, 'utf8', function (err) {
    if (err) {
      return console.log(err);
    }
  });
  console.table(bytecodes);
}

async function printByteCodes() {
  let bytecodes = await createByteCodeData();
  await writeData(bytecodes);
  
}

printByteCodes();
