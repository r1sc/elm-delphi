var fs = require('fs');
var process = require("process");
var path = require("path");

interface ElmDocModuleValue {
    name: string;
    comment: string;
    type: string;
}

interface ElmDocModule {
    name: string;
    comment: string;
    values: ElmDocModuleValue[];
}

interface ElmJsonDependencies {
    [key: string]: string;
}

interface ElmJson {
    dependencies: {
        direct: ElmJsonDependencies,
        indirect: ElmJsonDependencies
    }
}

interface ElmOracleCompatibleResult {
    name: string;
    fullName: string;
    href: string;
    signature: string;
    comment: string;
}

interface Array<T> {
    flatMap: <V>(predicate: (value: T) => V[]) => V[];
}

Array.prototype.flatMap = function <T, V>(predicate: (value: T) => V[]) {
    return [].concat.apply([], this.map(predicate));
}

function errorQuit(msg: string) {
    console.error(msg);
    process.exit(1);
}

function readFile(path: string) {
    return fs.readFileSync(path, { encoding: "UTF-8", flag: "r" }) as string;
}

function parseImports(elmCode: string) {
    let regex = /^import\s+(\w+)(?:\s+as\s+(\w+))?(?:\s+exposing\s+\(((?:[\w\.]+(?:,\s*)?)+)\))?$/gm;
    var imports = [];

    var myArray;
    while ((myArray = regex.exec(elmCode)) !== null) {
        const moduleName = myArray[1];
        const alias = myArray[2];
        const exposing = myArray[3];
        imports.push({ moduleName: moduleName, alias: alias || moduleName, exposed: exposing == undefined ? null : exposing.split(',').map(str => str.trim()) });
    }
    return imports;
}

function getAllDependenciesFromElmJson(elmPath: string) {
    const elmJsonPath = path.join(elmPath, "elm.json");
    const elmJson = JSON.parse(readFile(elmJsonPath)) as ElmJson;
    return elmJson.dependencies.direct;
}

function loadDocsForDependencies(dependencies: ElmJsonDependencies) {
    let allDocs: ElmDocModule[] = [];
    let packageFolder = path.join(process.env.appdata, "elm/0.19.0/package");
    for (let dependencyKey in dependencies) {
        const version = dependencies[dependencyKey];
        const docPath = path.join(packageFolder, dependencyKey, version, "documentation.json");
        const moduleDocs = JSON.parse(readFile(docPath)) as ElmDocModule[];
        allDocs = allDocs.concat(moduleDocs);
    }
    return allDocs;
}

function getDocForModule(moduleName: string) {
    return docs.find(doc => doc.name == moduleName);
}

function classifyQuery(query: string) {
    const parts = query.split('.');
    if (parts.length == 1) {
        return { name: query };
    }
    else if (parts.length > 1) {
        const name = parts[parts.length - 1];
        return { module: parts.slice(0, parts.length - 1).join("."), name: name };
    }
    else {
        errorQuit("Illegal query: " + query);
    }
}

function searchByModuleName(docs: ElmDocModule[], moduleName: string, name: string): ElmOracleCompatibleResult[] {
    return docs
        .filter(doc => doc.name == moduleName)
        .flatMap(doc => {
            return doc
                .values
                .filter(v => v.name.startsWith(name))
                .map(v => {
                    return {
                        name: v.name,
                        fullName: moduleName + "." + v.name,
                        href: "http://elm-lang.org",
                        signature: v.type,
                        comment: v.comment
                    }
                });
        });
}

// --- Program proper ---

let elmPath = process.cwd();
let file = process.argv[2];
if (file == undefined) {
    errorQuit("An elm-file relative to elm path is required");
}

let query = process.argv[3];
if (query == undefined) {
    errorQuit("A query is required. Either a function or a type name.");
}

const elmCode = 
`import Basics exposing (..)
import List exposing (List, (::))
import Maybe exposing (Maybe(..))
import Result exposing (Result(..))
import String exposing (String)
import Char exposing (Char)
import Tuple

import Debug

import Platform exposing ( Program )
import Platform.Cmd as Cmd exposing ( Cmd )
import Platform.Sub as Sub exposing ( Sub )
` + readFile(path.join(elmPath, file));

const imports = parseImports(elmCode)
const classifiedQuery = classifyQuery(query);

const hasElmJson = fs.existsSync(path.join(elmPath, "elm.json"))
if (!hasElmJson) {
    errorQuit("Cannot find elm.json in project path");
}

const dependencies = getAllDependenciesFromElmJson(elmPath);
const docs = loadDocsForDependencies(dependencies);

let result: ElmOracleCompatibleResult[] = [];
if (classifiedQuery == undefined) {
    errorQuit("Invalid query");
}
else if (classifiedQuery.module) {
    const refImport = imports.find(imp => imp.alias == classifiedQuery.module);
    if (refImport != undefined)
        result = searchByModuleName(docs, refImport.moduleName, classifiedQuery.name);
    
}
else {
    const modulesToSearch =
        imports
            .filter(x => x.exposed == null ? false : x.exposed.some(e => e == ".." || e.startsWith(classifiedQuery.name)))
            .map(x => x.moduleName);

    result = modulesToSearch
        .flatMap(moduleName => searchByModuleName(docs, moduleName, classifiedQuery.name));
}
console.log(JSON.stringify(result));