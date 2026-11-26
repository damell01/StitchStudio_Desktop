import {useId, useRef, useState} from 'react';
import {HelpCircle, PlayCircle} from 'lucide-react';
import digitizeImage from './help-images/digitize.png';
import insertImage from './help-images/insert.png';
import threadOrderImage from './help-images/thread-order.png';
import puffyLetteringImage from './help-images/puffy-lettering.png';
import appliqueImage from './help-images/applique.png';
export const stitchGuides=[
{kind:'auto',name:'Automatic',tip:'Let the engine choose based on artwork geometry.',watch:'Inspect small details and narrow regions.'},
{kind:'fill',name:'Fill / Tatami',tip:'Parallel rows cover larger solid areas.',watch:'Excess density can cause puckering and thread breaks.'},
{kind:'satin',name:'Satin',tip:'Alternating stitches create smooth columns and borders.',watch:'Wide columns may need split stitches or fill instead.'},
{kind:'run',name:'Running',tip:'A single line of stitches for outlines and fine details.',watch:'Very short stitches can damage fabric.'},
{kind:'contour',name:'Contour',tip:'Nested rows follow the outline of a shape.',watch:'Check tight corners and small interior gaps.'},
{kind:'blanket',name:'Blanket',tip:'Edge stitches with perpendicular prongs.',watch:'Check edge coverage and fabric stability.'},
{kind:'applique',name:'Appliqué',tip:'Attach a separate piece of fabric using placement, tack-down and finishing stitches.',watch:'Verify actual machine stops before sewing; trim only when the needle is stopped.'},
{kind:'meander',name:'Meander',tip:'A wandering line creates an open quilting texture.',watch:'Avoid tiny loops and excessive crossings.'},
{kind:'ripple',name:'Ripple',tip:'Spaced running-stitch contours create an open texture.',watch:'Check gaps and transitions between contours.'},
{kind:'cross',name:'Cross-stitch',tip:'Repeated X-shaped stitches create a grid texture.',watch:'Small cells can become overly dense.'},
{kind:'tartan',name:'Tartan',tip:'Intersecting stripes produce a woven appearance.',watch:'Overlapping stripes may build up density.'}
];
export function StitchIcon({kind}:{kind:string}){const rows=Array.from({length:6},(_,i)=>12+i*8);return <svg viewBox="0 0 100 64" width="100%" height="64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{kind==='fill'?rows.map((y,i)=><path key={y} d={`M12 ${y} H88 ${i<5?'v8':''}`} strokeDasharray="7 1"/>):kind==='satin'?<polyline points={Array.from({length:24},(_,i)=>[12+i*3.3,i%2?51:13].join(',')).join(' ')}/>:kind==='run'?<path d="M10 49 Q50 3 90 49" strokeDasharray="6 3"/>:kind==='blanket'?<><path d="M10 48 H90"/>{rows.map((_,i)=><path key={i} d={`M${15+i*14} 48 v-22`}/>)}</>:kind==='cross'?Array.from({length:15},(_,i)=>{const x=14+i%5*16,y=8+Math.floor(i/5)*17;return <path key={i} d={`M${x} ${y} l12 12 m0 -12 l-12 12`}/> }):kind==='applique'?<><rect x="16" y="9" width="68" height="46" rx="9" fill="#b8cdbb" strokeDasharray="3 3"/><rect x="20" y="13" width="60" height="38" rx="7" strokeWidth="4" strokeDasharray="1 2"/></>:kind==='meander'?<path d="M8 12 Q40 0 35 20 T65 28 T90 10 M8 34 Q25 14 36 38 T70 43 T90 32 M8 53 Q30 40 50 55 T90 53"/>:kind==='tartan'?<>{rows.map(y=><path key={y} d={`M12 ${y} H88 M${y+18} 8 V56`} opacity=".65"/>)}</>:kind==='auto'?<path d="M50 8 L58 24 78 27 64 41 67 59 50 50 33 59 36 41 22 27 42 24Z"/>:[0,1,2,3].map(i=><ellipse key={i} cx="50" cy="32" rx={39-i*8} ry={25-i*5} strokeDasharray={kind==='ripple'?'4 3':undefined}/>)}</svg>}
export function StitchPicker({value,onChange}:{value:string;onChange:(s:string)=>void}){const g=stitchGuides.find(s=>s.kind===value);return <><div className="stitch-picker">{stitchGuides.map(s=><button key={s.kind} aria-pressed={value===s.kind} onClick={()=>onChange(s.kind)}><StitchIcon kind={s.kind}/><strong>{s.name}</strong></button>)}</div>{g&&<div className="stitch-tip"><strong>{g.name}</strong><p>{g.tip}</p><p><strong>Watch for:</strong> {g.watch}</p></div>}</>}

type Lesson = {
  name: string;
  steps: string[];
  screenshot?: {src: string; alt: string};
  page?: string;
};

const lessons: Lesson[] = [
  {
    name: 'Digitize your first image',
    page: 'Digitize an image',
    steps: [
      'Choose Digitize artwork on Home, then choose or drop an image. Stitch Studio begins generating a draft automatically.',
      'Use Compare to review the artwork and stitch preview. Check that lettering, outlines and open spaces are still recognizable.',
      'Set the width and fabric for your project, then wait for the preview to regenerate.',
      'Choose Open in design studio and save the design as a Stitch Studio project.',
    ],
    screenshot: {src: digitizeImage, alt: 'The Choose or drop an image control on the Digitize page.'},
  },
  {
    name: 'Insert into an open design',
    steps: [
      'Choose Insert design in the studio toolbar. The current project stays open.',
      'Search Templates or switch to My designs for your imported machine files.',
      'Preview the item, set its width and placement when available, then choose Insert design.',
      'Use Layers or click the inserted item on the canvas to select and position it.',
    ],
    screenshot: {src: insertImage, alt: 'The Insert a design dialog with the Templates tab and a Thread spool search result.'},
  },
  {
    name: 'Map threads on a Poolin EOM',
    steps: [
      'Open Thread order in the studio toolbar. Read the numbered blocks from top to bottom. A thread color can appear in more than one block.',
      'Enter the needle or spool assignment beside each block to record your plan.',
      'Export the machine file and, if needed, save the printable thread worksheet from the export review.',
      'On the Poolin EOM, assign each block to the corresponding needle or spool using your plan. Confirm the order on the machine before sewing.',
    ],
    screenshot: {src: threadOrderImage, alt: 'The Thread order dialog with numbered blocks, repeated colors and needle or spool fields.'},
  },
  {
    name: 'Export to your machine',
    steps: [
      'Select your machine and check that the design fits inside the usable hoop.',
      'Choose Export design and pick a format your machine accepts, such as DST or PES.',
      'Review the sequence and warnings. Save a thread worksheet if you need the original colors alongside a DST file.',
      'Transfer the file using the method your machine supports and test sew on matching scrap fabric.',
    ],
  },
  {
    name: 'Make puffy lettering with foam',
    page: 'Create lettering',
    steps: [
      'Open Create → Create lettering. Enter your text and choose a broad block font with simple shapes.',
      'Under Embroidery effect, choose Foam satin with end caps (test sew). Set the capital height and review the lettering preview.',
      'Choose Add lettering to design. In the studio, review the sewing order. If the lettering follows flat embroidery, verify a machine pause before the foam stitches or plan a manual pause.',
      'On a test swatch, place embroidery foam before the foam block sews. After stitching, remove the excess foam and check that the end caps cover the cut edges.',
    ],
    screenshot: {src: puffyLetteringImage, alt: 'Lettering controls with Foam satin with end caps selected, a block layout and a capital height of 30 mm.'},
  },
  {
    name: 'Make an appliqué',
    page: 'Create appliqué',
    steps: [
      'Open Create → Create appliqué, then choose a shape and set its Artwork width.',
      'Use the numbered sewing-stage buttons to review placement, tack-down and the finishing edge. For pre-cut fabric, Export cutting SVG saves the placement outline with zero fabric allowance.',
      'Choose Create in Design Studio. Check the exported sequence for the pauses your machine needs. Color changes and stops can behave differently.',
      'Test sew on scrap. Sew the placement line, pause and position the fabric, then sew the tack-down. Pause to trim excess fabric if needed before sewing the finishing edge.',
    ],
    screenshot: {src: appliqueImage, alt: 'The appliqué design preview with the Tack-down stage selected and the sewing sequence below it.'},
  },
  {
    name: 'Prevent puckering and thread breaks',
    steps: [
      'Choose a stabilizer, needle and thread suited to your fabric.',
      'Inspect density, repeated stitching, short stitches, wide satin spans and small lettering.',
      'Test sew on matching scrap fabric and adjust the design before production.',
    ],
  },
];

function LessonSteps({lesson}: {lesson: Lesson}) {
  return (
    <>
      <ol>{lesson.steps.map(step => <li key={step}>{step}</li>)}</ol>
      {lesson.screenshot && (
        <details className="help-screenshot">
          <summary>Show screenshot</summary>
          <img src={lesson.screenshot.src} alt={lesson.screenshot.alt} loading="lazy"/>
        </details>
      )}
    </>
  );
}

export function WorkflowHelp({page}: {page: string}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const lesson = lessons.find(item => item.page === page);
  if (!lesson) return null;

  return (
    <>
      <button type="button" aria-label={`How to: ${lesson.name}`} title={lesson.name} onClick={() => dialog.current?.showModal()}>
        <HelpCircle size={16} aria-hidden="true"/>
      </button>
      <dialog ref={dialog} className="workflow-help" aria-labelledby={titleId}>
        <div className="workflow-help-heading">
          <h2 id={titleId}>{lesson.name}</h2>
          <button type="button" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <LessonSteps lesson={lesson}/>
      </dialog>
    </>
  );
}

export function HelpCenter({onStartTour}: {onStartTour: () => void}) {
  const [active, setActive] = useState(lessons[0].name);
  const [lessonQuery, setLessonQuery] = useState('');
  const [stitchQuery, setStitchQuery] = useState('');
  const matchingLessons = lessons.filter(lesson =>
    [lesson.name, ...lesson.steps].join(' ').toLowerCase().includes(lessonQuery.trim().toLowerCase()));
  const lesson = matchingLessons.find(item => item.name === active) ?? matchingLessons[0];
  const visibleStitches = stitchGuides.filter(stitch =>
    [stitch.name, stitch.tip, stitch.watch].join(' ').toLowerCase().includes(stitchQuery.trim().toLowerCase()));

  return (
    <section className="help-workspace help-dashboard">
      <div className="help-lesson-layout">
        <div className="help-lesson-nav">
          <h2>How-to guides</h2>
          <input type="search" aria-label="Search how-to guides" placeholder="Search how-to guides…" value={lessonQuery} onChange={event => setLessonQuery(event.target.value)}/>
          <nav aria-label="How-to guides">
            {matchingLessons.map(item => (
              <button key={item.name} aria-pressed={lesson?.name === item.name} onClick={() => setActive(item.name)}>{item.name}</button>
            ))}
          </nav>
          <button className="help-tour-launch" onClick={onStartTour}><PlayCircle size={16} aria-hidden="true"/> Start guided tour</button>
        </div>
        {lesson ? (
          <article className="help-lesson-card" key={lesson.name}>
            <h2>{lesson.name}</h2>
            <LessonSteps lesson={lesson}/>
          </article>
        ) : (
          <article className="help-lesson-card"><p role="status">No matching guides. Try searching for a tool or action.</p></article>
        )}
      </div>
      <div className="help-reference-heading">
        <div><h2>Visual stitch reference</h2><small>Explore stitch types and their uses.</small></div>
        <input type="search" aria-label="Search stitch types" placeholder="Search stitch types…" value={stitchQuery} onChange={event => setStitchQuery(event.target.value)}/>
      </div>
      <div className="template-grid help-stitch-grid">
        {visibleStitches.map(stitch => (
          <article key={stitch.kind}>
            <div className="help-stitch-preview"><StitchIcon kind={stitch.kind}/></div>
            <h2>{stitch.name}</h2>
            <p>{stitch.tip}</p>
            <details><summary>What to watch for</summary><small>{stitch.watch}</small></details>
          </article>
        ))}
      </div>
      {!visibleStitches.length && <p role="status">No matching stitch types.</p>}
    </section>
  );
}
