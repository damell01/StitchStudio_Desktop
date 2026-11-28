// Keeps one failing editor panel from blanking the whole studio. The design
// itself lives in the native workspace, so reopening the editor loses nothing.
import {Component,type ReactNode} from 'react';
import {RotateCcw} from 'lucide-react';

type State={error:Error|null;attempt:number};
export class EditorBoundary extends Component<{children:(attempt:number)=>ReactNode},State>{
  state:State={error:null,attempt:0};
  static getDerivedStateFromError(error:Error){return {error}}
  componentDidCatch(error:Error){console.error('Design studio error',error)}
  render(){
    if(!this.state.error)return this.props.children(this.state.attempt);
    return <section className="editor-crash" role="alert">
      <h2>The design studio hit a problem</h2>
      <p>Your design is safe. Reopen the studio to keep working. If this keeps happening, save your project and send us what you were doing.</p>
      <small>{this.state.error.message}</small>
      <button className="primary" onClick={()=>this.setState(s=>({error:null,attempt:s.attempt+1}))}><RotateCcw size={16}/> Reopen design studio</button>
    </section>;
  }
}
