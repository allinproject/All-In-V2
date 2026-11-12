/** Dependency-pinned AST safety lint for V2 client source; no lint-package install.
 * It is deliberately not a substitute for a complete stylistic ESLint ruleset.
 */
import {createRequire} from 'node:module';
import {readdirSync,readFileSync} from 'node:fs';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const requireFromMobile=createRequire(resolve(repoRoot,'apps/mobile-v2/package.json'));
const ts=requireFromMobile('typescript');
const clientRoot=resolve(repoRoot,'apps/mobile-v2');
const scriptKinds={'.ts':ts.ScriptKind.TS,'.tsx':ts.ScriptKind.TSX,'.js':ts.ScriptKind.JS,'.mjs':ts.ScriptKind.JS};
const sensitivePublic=/(?:SERVICE[_-]?ROLE|SECRET|PRIVATE[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|STRIPE[_-]?SECRET|WEBHOOK[_-]?SECRET)/i;

function staticEnvName(node){
 if(ts.isPropertyAccessExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
  ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='process'&&
  node.expression.name.text==='env')return node.name.text;
 if(ts.isElementAccessExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
  ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='process'&&
  node.expression.name.text==='env'&&node.argumentExpression&&ts.isStringLiteral(node.argumentExpression))
  return node.argumentExpression.text;
 return null;
}

export function lintSource(source,file='fixture.ts'){
 const kind=scriptKinds[extname(file)]??ts.ScriptKind.TS;
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,kind);
 const findings=[];
 function add(node,reason){
  const loc=ast.getLineAndCharacterOfPosition(node.getStart(ast));
  findings.push(`${file}:${loc.line+1}:${loc.character+1} ${reason}`);
 }
 function walk(node){
  if(ts.isDebuggerStatement(node))add(node,'debugger statement is prohibited');
  if((ts.isCallExpression(node)||ts.isNewExpression(node))&&ts.isIdentifier(node.expression)&&
   ['eval','Function'].includes(node.expression.text))add(node,'dynamic code evaluation is prohibited');
  const key=staticEnvName(node);
  if(key?.startsWith('EXPO_PUBLIC_')&&sensitivePublic.test(key.slice('EXPO_PUBLIC_'.length)))
   add(node,'privileged key must not use EXPO_PUBLIC_');
  ts.forEachChild(node,walk);
 }
 walk(ast);
 return findings;
}

function* sourceFiles(dir){
 for(const item of readdirSync(dir,{withFileTypes:true})){
  if(item.isDirectory()){
   if(!['node_modules','.expo','.git'].includes(item.name))yield* sourceFiles(join(dir,item.name));
  }else if(item.isFile()&&scriptKinds[extname(item.name)]&&
   !item.name.endsWith('.d.ts'))yield join(dir,item.name);
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const findings=[];
 let checked=0;
 for(const folder of ['app','src'])for(const file of sourceFiles(resolve(clientRoot,folder))){
  checked++;
  findings.push(...lintSource(readFileSync(file,'utf8'),file.slice(repoRoot.length+1)));
 }
 if(findings.length){for(const finding of findings)console.error(finding);process.exitCode=1;}
 else console.log(`V2 client AST safety lint PASS (${checked} source files)`);
}
