import { CardType, EnergyCard } from '../../../common';

export class LightningEnergy extends EnergyCard {
  public provides: CardType[] = [CardType.LIGHTNING];

  public set: string = 'DP';

  public name = 'Lightning Energy';

  public fullName = 'Lightning Energy EVO';
}
