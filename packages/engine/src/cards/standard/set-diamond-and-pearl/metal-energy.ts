import { CardType, EnergyCard } from '../../../common';

export class MetalEnergy extends EnergyCard {
  public provides: CardType[] = [CardType.METAL];

  public set: string = 'DP';

  public name = 'Metal Energy';

  public fullName = 'Metal Energy EVO';
}
