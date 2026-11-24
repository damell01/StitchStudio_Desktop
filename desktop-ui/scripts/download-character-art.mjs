import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const dir=process.argv[2]||join(process.env.USERPROFILE||process.env.HOME||'.','StitchStudio Artwork','Pokemon');
await mkdir(dir,{recursive:true});
const entries=[[1,"Bulbasaur"],[4,"Charmander"],[7,"Squirtle"],[25,"Pikachu"],[39,"Jigglypuff"],[52,"Meowth"],[94,"Gengar"],[133,"Eevee"],[143,"Snorlax"],[149,"Dragonite"],[151,"Mew"],[175,"Togepi"],[196,"Espeon"],[197,"Umbreon"],[257,"Blaziken"],[282,"Gardevoir"],[448,"Lucario"],[700,"Sylveon"],[778,"Mimikyu"],[906,"Sprigatito"]];
let failed=0;
for(const [id,name] of entries){try{const response=await fetch('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'+id+'.png',{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2000000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG');await writeFile(join(dir,name+'.png'),bytes);console.log('Saved '+name)}catch(e){failed++;console.error(name+': '+e.message)}}
console.log('Artwork folder: '+dir);if(failed)process.exitCode=1;
