import { Observable } from '@/utils/Observable';

/** Sovelluksen näkymät. Kevyt tilaperustainen navigointi ilman reititinkirjastoa. */
export type Screen =
  | { name: 'home' }
  | { name: 'calibration' }
  | { name: 'recording' }
  | { name: 'library' }
  | { name: 'player'; recordingId: string };

export interface AppState {
  screen: Screen;
}

/**
 * AppViewModel hallitsee näkymien välistä navigointia. Erotettu omaksi
 * ViewModeliksi, jotta navigointilogiikka on testattavissa ja näkymät
 * pysyvät ohuina.
 */
export class AppViewModel extends Observable<AppState> {
  constructor() {
    super({ screen: { name: 'home' } });
  }

  goHome(): void {
    this.setState({ screen: { name: 'home' } });
  }

  goCalibration(): void {
    this.setState({ screen: { name: 'calibration' } });
  }

  goRecording(): void {
    this.setState({ screen: { name: 'recording' } });
  }

  goLibrary(): void {
    this.setState({ screen: { name: 'library' } });
  }

  goPlayer(recordingId: string): void {
    this.setState({ screen: { name: 'player', recordingId } });
  }
}
