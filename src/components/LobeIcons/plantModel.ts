export type PlantModel = 'maple' | 'sage' | 'fern' | 'moss';

export const getPlantModel = (model?: string): PlantModel | undefined => {
  switch (model?.toLowerCase()) {
    case 'group/maple': {
      return 'maple';
    }
    case 'group/sage': {
      return 'sage';
    }
    case 'group/fern': {
      return 'fern';
    }
    case 'group/moss': {
      return 'moss';
    }
  }
};
