import { sitePath } from "./site-path";

export default function Home() {
  return (
    <main>
      <nav className="site-nav wrap">
        <a className="site-brand" href={sitePath()}>
          <span className="brand-wave"><i /><i /><i /></span>
          <span><strong>SingRight</strong><small>准唱</small></span>
        </a>
        <div className="nav-links">
          <a href="#modes">练习模式</a>
          <a href="#format">曲谱格式</a>
          <a href="https://github.com/polynomial1027/songs-tuner" target="_blank" rel="noreferrer">GitHub</a>
          <a className="nav-download" href={sitePath("download")}>免费下载 <span>↗</span></a>
        </div>
      </nav>

      <section className="hero wrap">
        <div className="hero-copy">
          <div className="hero-kicker"><i /> 跨平台 · 音频只在本机处理</div>
          <h1>把每一个音，<br /><em>唱到点上。</em></h1>
          <p>SingRight 用麦克风实时听见你的音高。逐个音磨准、跟着时值连续唱，或录完整首再集中纠错。</p>
          <div className="hero-actions">
            <a className="button primary" href={sitePath("download")}>下载 SingRight <span>↓</span></a>
            <a className="button secondary" href="https://github.com/polynomial1027/songs-tuner" target="_blank" rel="noreferrer">查看源代码 <span>↗</span></a>
          </div>
          <div className="platform-line">
            <span>适用于</span><i>macOS</i><i>Windows</i><i>Linux</i>
          </div>
        </div>

        <div className="hero-product" aria-label="SingRight 音准练习界面预览">
          <div className="product-top">
            <div><span className="micro-dot" /> PITCH LAB</div>
            <span>从低到高 · C 大调音阶</span>
            <i>•••</i>
          </div>
          <div className="product-mode"><b>逐音校准</b><span>连续跟唱</span><span>整曲复盘</span></div>
          <div className="mini-score">
            <div className="score-lines"><i /><i /><i /><i /><i /></div>
            <div className="score-blocks">
              {["1", "2", "3", "4", "5", "6", "7", "1·"].map((note, index) => (
                <span key={note + index} className={index === 3 ? "now" : index < 3 ? "done" : ""} style={{ bottom: `${20 + index * 6}%` }}>{note}<small>{["哆", "来", "咪", "发", "嗦", "啦", "西", "哆"][index]}</small></span>
              ))}
              <strong />
            </div>
          </div>
          <div className="product-tuner">
            <div><span>目标音</span><strong>F4</strong><small>349.2 Hz</small></div>
            <div className="tuner-center">
              <b>−4 <small>cents</small></b>
              <div><i /></div>
              <span><em>−100</em><em>−50</em><em>0</em><em>+50</em><em>+100</em></span>
            </div>
            <div><span>实时音高</span><strong>F4</strong><small>348.4 Hz · 97%</small></div>
          </div>
          <div className="product-transport"><button>‹</button><b>Ⅱ&nbsp;&nbsp;结束并复盘</b><button>›</button></div>
        </div>
      </section>

      <section className="signal-strip">
        <div className="wrap">
          <span>REAL-TIME PITCH</span>
          <div>{Array.from({ length: 44 }, (_, index) => <i key={index} style={{ height: `${10 + (Math.sin(index * .72) + 1) * 12}px` }} />)}</div>
          <strong>A4 · 440 Hz</strong>
        </div>
      </section>

      <section className="modes-section wrap" id="modes">
        <div className="section-heading">
          <span>THREE WAYS TO PRACTICE / 三种练法</span>
          <h2>从一个音，到整首歌。</h2>
          <p>不是泛泛地告诉你“唱得不错”，而是把偏低、偏高和不稳定具体到每一个音。</p>
        </div>
        <div className="mode-cards">
          <article>
            <div className="mode-number">01</div>
            <div className="target-glyph"><i /><i /><b /></div>
            <h3>逐音校准</h3>
            <p>不计算时值。唱准当前音并稳定保持后，自动进入下一个音，适合慢慢抠难句。</p>
            <span>稳定保持判定 <b>650 ms</b></span>
          </article>
          <article className="featured">
            <div className="mode-number">02</div>
            <div className="timeline-glyph"><i /><i /><i /><b /></div>
            <h3>连续跟唱</h3>
            <p>速度、拍点和音高一起判断。像 KTV 一样沿时间线推进，同时看见实时 cents 偏差。</p>
            <span>音高 + 时值 <b>实时</b></span>
          </article>
          <article>
            <div className="mode-number">03</div>
            <div className="review-glyph"><strong>87</strong><i /></div>
            <h3>整曲复盘</h3>
            <p>完整录下一遍演唱，再逐音标出“准、接近、需要重练”，录音可以留在本机回听。</p>
            <span>录音分析 <b>逐音报告</b></span>
          </article>
        </div>
      </section>

      <section className="format-section" id="format">
        <div className="format-grid wrap">
          <div className="format-copy">
            <span>ONE FORMAT, ANY SONG / 统一曲谱</span>
            <h2>你的歌，<br />用一种格式导入。</h2>
            <p><code>.singright.json</code> 同时保存音高、拍点、时值、简谱唱名和歌词。它是普通文本，人可以编辑，程序也能严格校验。</p>
            <ul>
              <li><i>✓</i> MIDI 音高，不被某一种调号绑定</li>
              <li><i>✓</i> 拍数时值，换 BPM 也不会乱</li>
              <li><i>✓</i> 支持休止、歌词、简谱显示与 A4 基准</li>
            </ul>
            <div className="format-actions">
              <a href="https://github.com/polynomial1027/songs-tuner/blob/main/docs/SCORE_FORMAT.zh-CN.md" target="_blank" rel="noreferrer">阅读格式说明 ↗</a>
              <a href="https://raw.githubusercontent.com/polynomial1027/songs-tuner/main/examples/empty-song.singright.json">下载空白模板 ↓</a>
            </div>
          </div>
          <div className="code-card">
            <div className="code-head"><span>my-song.singright.json</span><i>JSON · UTF-8</i></div>
            <pre><code>{`{
  "format": "singright-score",
  "version": 1,
  "metadata": {
    "title": "我的歌曲"
  },
  "tempo": { "bpm": 88 },
  "tuning": {
    "referenceHz": 440,
    "tonicMidi": 60
  },
  "notes": [
    {
      "midi": 60,
      "beat": 0,
      "durationBeats": 1,
      "numeral": "1",
      "lyric": "唱"
    }
  ]
}`}</code></pre>
          </div>
        </div>
      </section>

      <section className="control-section wrap">
        <div className="control-visual">
          <div className="dial"><span>−3</span><small>SEMITONES</small><i /></div>
          <div className="frequency"><span>A4 REFERENCE</span><strong>440.0</strong><small>Hz</small><i /></div>
        </div>
        <div className="control-copy">
          <span>YOUR KEY, YOUR RANGE / 你的调</span>
          <h2>不必勉强唱原调。</h2>
          <p>按半音自由升降，或者直接唱出第一个基准音，让 SingRight 自动固定后续所有音。还可在 430–450 Hz 之间调整 A4。</p>
          <div><i>±12</i><span>半音移调范围</span><i>±15–50</i><span>cents 容差</span></div>
        </div>
      </section>

      <section className="privacy-section">
        <div className="wrap privacy-card">
          <div className="privacy-lock"><span /><i /></div>
          <div><span>LOCAL-FIRST PRIVACY</span><h2>你的声音，留在你的设备里。</h2><p>实时音高检测、录音分析和练习报告默认都在本机完成。SingRight 不需要账户，也不会把麦克风音频发送到服务器。</p></div>
          <a href="https://github.com/polynomial1027/songs-tuner" target="_blank" rel="noreferrer">开放源码，可自行检查 ↗</a>
        </div>
      </section>

      <section className="final-cta wrap">
        <div><span>READY WHEN YOU ARE</span><h2>下一次开口，<br />比这一次更准。</h2></div>
        <div><a className="button primary" href={sitePath("download")}>免费下载 SingRight <span>↓</span></a><small>MIT 开源 · macOS / Windows / Linux</small></div>
      </section>

      <footer>
        <div className="wrap">
          <a className="site-brand" href={sitePath()}><span className="brand-wave"><i /><i /><i /></span><span><strong>SingRight</strong><small>准唱</small></span></a>
          <p>练准每一个音。</p>
          <div><a href={sitePath("download")}>下载</a><a href="https://github.com/polynomial1027/songs-tuner">GitHub</a><a href="https://github.com/polynomial1027/songs-tuner/blob/main/LICENSE">MIT License</a></div>
        </div>
      </footer>
    </main>
  );
}
