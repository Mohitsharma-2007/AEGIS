let workerPromise=null;
function makeWorker(){
  const base=window.location.origin+'/ocr';
  return import('tesseract.js').then(async({createWorker,OEM,PSM})=>{
    const worker=await createWorker('eng',OEM.LSTM_ONLY,{workerPath:base+'/worker.min.js',corePath:base,langPath:base,workerBlobURL:false,gzip:true,cacheMethod:'none',errorHandler:()=>{}});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1'});
    return worker;
  });
}

export async function readScreenText(image,signal){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(!workerPromise){workerPromise=makeWorker();workerPromise.catch(()=>{workerPromise=null;});}
  const worker=await workerPromise;
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const {data}=await worker.recognize(image);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const text=String(data?.text||'').replace(/[^\S\n]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,2400);
  return {text,confidence:Math.round(data?.confidence||0)};
}
