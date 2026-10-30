# {Shan, Shui}*
Procedurally-generated vector-format infinitely-scrolling Chinese landscape for the browser.
Generate your own on https://lingdong-.github.io/shan-shui-inf/ (or [Alternative link](https://shan-shui-inf.glitch.me)).

Some examples:
![Screenshot1](/screenshots/screen001.jpg?raw=true "")
![Screenshot2](/screenshots/screen002.jpg?raw=true "")

{Shan, Shui}\* is inspired by [traditional Chinese landscape scrolls](https://en.wikipedia.org/wiki/Shan_shui) (such as [this](https://en.wikipedia.org/wiki/Dwelling_in_the_Fuchun_Mountains) and [this](https://en.wikipedia.org/wiki/Wang_Ximeng)) and uses noises and mathematical functions to model the mountains and trees from scratch. It is written entirely in javascript and outputs Scalable Vector Graphics (SVG) format.


## GPU port review stack: 1/8

**Establish GPU construction and painting primitives.** The original application above remains the default demo
while the GPU library is assembled in reviewable stages.

Run `npm ci`, `npm test`, `npm run check:shaders`, and `npm run test:gpu`.
Native acceptance needs WebGPU; install the portable renderer with
`npx vgpu install-software-renderer` and set `VGPU_ADAPTER=software` when needed.
See [verification](docs/verification.md) and [upstream provenance](docs/upstream.md).
The GPU seed mapping differs from the original. Software execution is not a
hardware-performance measurement. No public browser API is exposed before stage 6.
