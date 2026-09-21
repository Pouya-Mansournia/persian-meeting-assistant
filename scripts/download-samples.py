"""Download three public FLEURS Persian test clips (CC BY 4.0)."""
from pathlib import Path
import shutil
from huggingface_hub import hf_hub_download

root = Path(__file__).resolve().parents[1]
out = root / 'artifacts/audio'
out.mkdir(parents=True, exist_ok=True)
for name in ('fa_ir.trans.txt', 'fa_ir_0000.wav', 'fa_ir_0001.wav', 'fa_ir_0002.wav'):
    source = hf_hub_download('FluidInference/fleurs-full', 'fa_ir/' + name,
                             repo_type='dataset', cache_dir=root / 'data/sample-cache')
    shutil.copy2(source, out / name)
print('Downloaded public Persian samples to artifacts/audio')
