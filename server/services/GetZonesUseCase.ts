import { IZoneRepository } from '../repositories/IZoneRepository';
import { CampusZoneDTO } from './dtos';
import { NotFoundError } from '../errors';

export class GetZonesUseCase {
  constructor(private readonly zoneRepo: IZoneRepository) {}

  public async execute(): Promise<CampusZoneDTO[]> {
    const zones = await this.zoneRepo.findAll();
    return zones.map((z) => ({
      id: z.id,
      name: z.name,
      code: z.code,
      description: z.props.description,
      svgPath: z.props.svgPath,
      centerCoordinates: z.props.centerCoordinates,
      centerSvgCoordinates: z.props.centerSvgCoordinates,
      centerLat: z.props.centerCoordinates.lat,
      centerLng: z.props.centerCoordinates.lng,
      centerSvgX: z.props.centerSvgCoordinates.x,
      centerSvgY: z.props.centerSvgCoordinates.y,
      activeSpawnsCount: z.props.activeSpawnsCount,
      totalPointsAvailable: z.props.totalPointsAvailable,
      color: z.props.color,
    }));
  }
}

export class GetZoneByIdUseCase {
  constructor(private readonly zoneRepo: IZoneRepository) {}

  public async execute(id: string): Promise<CampusZoneDTO> {
    const zone = await this.zoneRepo.findById(id);
    if (!zone) {
      throw new NotFoundError(`Zone with id "${id}" not found`);
    }

    return {
      id: zone.id,
      name: zone.name,
      code: zone.code,
      description: zone.props.description,
      svgPath: zone.props.svgPath,
      centerCoordinates: zone.props.centerCoordinates,
      centerSvgCoordinates: zone.props.centerSvgCoordinates,
      centerLat: zone.props.centerCoordinates.lat,
      centerLng: zone.props.centerCoordinates.lng,
      centerSvgX: zone.props.centerSvgCoordinates.x,
      centerSvgY: zone.props.centerSvgCoordinates.y,
      activeSpawnsCount: zone.props.activeSpawnsCount,
      totalPointsAvailable: zone.props.totalPointsAvailable,
      color: zone.props.color,
    };
  }
}
