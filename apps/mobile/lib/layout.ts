import { StyleSheet } from 'react-native';

/**
 * Ekrandan daşmanın qarşısını almaq üçün ümumi layout qaydaları.
 * Sıralı (row) layout-larda Text/View üçün flexShrink + minWidth vacibdir.
 */
export const layout = StyleSheet.create({
  /** flex:1 uşaq — en məhdudiyyəti üçün */
  flexFill: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  /** Sıradakı mətn — uzun sözlər kəsilir / bükülür */
  flexText: {
    flexShrink: 1,
    minWidth: 0,
  },
  /** Row içində bükülə bilən məzmun */
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  screenPad: {
    paddingHorizontal: 16,
  },
});
