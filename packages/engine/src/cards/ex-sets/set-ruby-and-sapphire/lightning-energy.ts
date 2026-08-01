import { CardType, EnergyCard } from '../../../common';

export class LightningEnergy extends EnergyCard {
  public provides: CardType[] = [CardType.LIGHTNING];

  public set: string = 'RS';

  public name: string = 'Lightning Energy';

  public fullName: string = 'Lightning Energy RS';
}
