import { Coordinates, SvgCoordinates } from '../types';

export interface CampusZoneProps {
  id: string;
  name: string;
  code: string;
  description: string;
  svgPath: string;
  centerCoordinates: Coordinates;
  centerSvgCoordinates: SvgCoordinates;
  activeSpawnsCount: number;
  totalPointsAvailable: number;
  color?: string;
}

export class CampusZone {
  constructor(public readonly props: CampusZoneProps) {}

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get code(): string {
    return this.props.code;
  }

  get activeSpawnsCount(): number {
    return this.props.activeSpawnsCount;
  }
}
