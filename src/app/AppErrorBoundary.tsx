import { Component, createRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../shared/ui';

export class AppErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  private notice = createRef<HTMLDivElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.notice.current?.focus(); }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="error-page" role="alert" ref={this.notice} tabIndex={-1}>
      <p className="eyebrow">AMPARA SESMT</p><h1>Não foi possível exibir esta página.</h1>
      <p>Volte ao início ou recarregue a aplicação para tentar novamente. Alterações que não foram enviadas podem precisar ser preenchidas novamente.</p>
      <div className="actions" style={{ justifyContent: 'center' }}><Link className="button button--secondary" to="/app">Voltar ao início</Link><Button onClick={() => window.location.reload()}>Recarregar aplicação</Button></div>
    </div>;
  }
}
