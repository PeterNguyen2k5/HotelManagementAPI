import {inflateRawSync} from 'node:zlib';

// Small ZIP fixture reader/writer for tests; production extraction uses System.IO.Compression.
export function readZip(buffer){
 const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(end<0)throw Error('Missing ZIP directory');
 const result=[];let offset=buffer.readUInt32LE(end+16);
 for(let i=0;i<buffer.readUInt16LE(end+10);i++){
  if(buffer.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid ZIP directory');
  const nameLength=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32);
  const name=buffer.subarray(offset+46,offset+46+nameLength).toString('utf8'),size=buffer.readUInt32LE(offset+20),method=buffer.readUInt16LE(offset+10),local=buffer.readUInt32LE(offset+42);
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),compressed=buffer.subarray(start,start+size);
  result.push({name,data:method===0?Buffer.from(compressed):method===8?inflateRawSync(compressed):(()=>{throw Error('Unsupported ZIP fixture method')})(),attributes:buffer.readUInt32LE(offset+38)});
  offset+=46+nameLength+extra+comment;
 }return result;
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function writeZip(files){
 const body=[],central=[];let offset=0;
 for(const file of files){
  const name=Buffer.from(file.name),data=Buffer.from(file.data),crc=crc32(data),local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(0x0314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE((file.attributes||0)>>>0,38);directory.writeUInt32LE(offset,42);
  body.push(local,name,data);central.push(directory,name);offset+=local.length+name.length+data.length;
 }
 const directories=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directories.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...body,directories,end]);
}
