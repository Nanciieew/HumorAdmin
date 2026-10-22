import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {captionOverlay,renderFactoryMemes,MEME_TYPE,CaptionLayoutError} from '../lib/factory/render.ts';

async function fixture(width=800,height=600) {
 // A textured original detects re-encoding changes that a flat fill can hide.
 const pixels=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*3;pixels[i]=(x*7+y*3)%256;pixels[i+1]=(x+y*13)%256;pixels[i+2]=(x*3+y*5)%256;
 }
 const bytes=await sharp(pixels,{raw:{width,height,channels:3}}).png().toBuffer();
 return {image:`data:image/png;base64,${bytes.toString('base64')}`,bytes};
}
test('the same original gets the exact same font size, baseline and outline for every caption',async()=>{
 const first=await captionOverlay('NO THANKS',1200,800);
 const second=await captionOverlay('MY BUDGET FILED A RESTRAINING ORDER AGAINST ME',1200,800);
 assert.equal(first.fontSize,second.fontSize);assert.equal(first.lastBaseline,second.lastBaseline);
 assert.equal(first.fontSize,MEME_TYPE.fontSize*0.8);
 assert.ok(first.lastBaseline>800*.9);assert.ok(second.svg.toString().includes('stroke="#000"'));
 assert.ok(second.svg.toString().includes('fill="#fff"'));
 assert.ok(second.svg.toString().includes('<path '));assert.ok(!second.svg.toString().includes('<text'));
});
test('only caption pixels change; native dimensions and the entire remaining image are preserved exactly',async()=>{
 const {image,bytes}=await fixture();
 const [rendered,again]=await renderFactoryMemes(image,['MY BUDGET SAID NO','MY BUDGET SAID NO']);
 assert.deepEqual(rendered,again,'identical inputs produce identical images');
 const original=await sharp(bytes).ensureAlpha().raw().toBuffer();
 const result=await sharp(rendered).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(result.info.width,800);assert.equal(result.info.height,600);
 const overlay=await captionOverlay('MY BUDGET SAID NO',800,600);
 const alpha=await sharp(overlay.svg).ensureAlpha().raw().toBuffer();
 let changed=0;
 for(let pixel=0;pixel<800*600;pixel++){
  const offset=pixel*4;
  if(alpha[offset+3]===0)assert.deepEqual(result.data.subarray(offset,offset+4),original.subarray(offset,offset+4));
  else if(!result.data.subarray(offset,offset+4).equals(original.subarray(offset,offset+4)))changed++;
 }
 assert.ok(changed>100,'caption is actually drawn');
 assert.deepEqual(result.data.subarray(0,800*400*4),original.subarray(0,800*400*4));
});
test('landscape, portrait and small images keep their original sizes',async()=>{
 for(const [width,height] of [[900,300],[300,900],[40,40]]){
  const {image}=await fixture(width,height);const [rendered]=await renderFactoryMemes(image,['NOT TODAY']);
  const metadata=await sharp(rendered).metadata();assert.equal(metadata.width,width);assert.equal(metadata.height,height);
 }
});
test('overlong or unsupported captions are rejected instead of shrinking type or silently substituting fonts',async()=>{
 await assert.rejects(captionOverlay('SOMETHING '.repeat(100),600,600),CaptionLayoutError);
 await assert.rejects(captionOverlay('HELLO 🦄',600,600),CaptionLayoutError);
});
test('EXIF orientation is honoured without cropping or scaling',async()=>{
 const source=await sharp({create:{width:300,height:500,channels:3,background:'#6284ba'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const [rendered]=await renderFactoryMemes(`data:image/jpeg;base64,${source.toString('base64')}`,['NOT TODAY']);
 const meta=await sharp(rendered).metadata();assert.equal(meta.width,500);assert.equal(meta.height,300);
});


test('long caption lines rasterize completely instead of losing glyphs after the first few letters',async()=>{
 const width=1269,height=2825;
 const overlay=await captionOverlay('My third Celsius hit during class',width,height);
 assert.deepEqual(overlay.lines,['MY THIRD CELSIUS HIT','DURING CLASS']);
 const scale=width/MEME_TYPE.referenceShortEdge;
 const firstBaseline=overlay.lastBaseline-MEME_TYPE.lineHeight*scale;
 const top=Math.floor(firstBaseline-overlay.fontSize);
 const band=await sharp(overlay.svg).extract({left:0,top,width,height:Math.ceil(overlay.fontSize+MEME_TYPE.strokeWidth*scale)}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 // The reported failure only drew "MY THIR" at the far left. Check ink
 // across the middle and end of the actual first line, not just its text data.
 for(const [left,right] of [[width*.35,width*.5],[width*.65,width*.8],[width*.85,width*.93]]){
  let ink=0;
  for(let y=0;y<band.info.height;y++)for(let x=Math.floor(left);x<Math.floor(right);x++)if(band.data[(y*width+x)*4+3]>0)ink++;
  assert.ok(ink>100,`missing caption glyphs between ${left} and ${right}`);
 }
});


test('new caption type is twice the previous size and wraps onto two lines without shrinking',async()=>{
 const short=await captionOverlay('NOT TODAY',1000,1000);
 const wrapped=await captionOverlay('MY BUDGET SAID NO TO GROCERIES',1000,1000);
 assert.equal(short.fontSize,96);
 assert.equal(wrapped.fontSize,96);
 assert.deepEqual(wrapped.lines,['MY BUDGET SAID NO TO','GROCERIES']);
 assert.equal((wrapped.svg.toString().match(/<path /g)||[]).length,2);
 const pixels=await sharp(wrapped.svg).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const firstTop=wrapped.lastBaseline-MEME_TYPE.lineHeight-wrapped.fontSize;
 let firstInk=0,secondInk=0;
 for(let y=0;y<pixels.info.height;y++)for(let x=0;x<pixels.info.width;x++){
  if(!pixels.data[(y*pixels.info.width+x)*4+3])continue;
  if(y>=firstTop&&y<wrapped.lastBaseline-MEME_TYPE.lineHeight)firstInk++;
  if(y>=wrapped.lastBaseline-wrapped.fontSize&&y<wrapped.lastBaseline)secondInk++;
 }
 assert.ok(firstInk>1000,'the larger first line is visible');
 assert.ok(secondInk>1000,'the larger second line is visible');
});
