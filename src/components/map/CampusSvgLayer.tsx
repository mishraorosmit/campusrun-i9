import React from 'react';
import campusMapSvg from '../../../campus-rmap1.svg?raw';
import { CampusLandmark, getLandmarkById } from '../../data/landmarks';

interface CampusSvgLayerProps {
  selectedLandmarkId?: string | null;
  onSelectLandmark?: (landmarkId: string) => void;
}

export const CampusSvgLayer: React.FC<CampusSvgLayerProps> = ({
  onSelectLandmark,
}) => {
  const handleClick = (event: React.MouseEvent<SVGGElement>) => {
    const element = (event.target as Element).closest('[id]');
    const id = element?.getAttribute('id');
    if (id && getLandmarkById(id as CampusLandmark['id'])) {
      event.stopPropagation();
      onSelectLandmark?.(id);
    }
  };

  return (
    <g
      id="campus-svg-map"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: campusMapSvg }}
    />
  );
};