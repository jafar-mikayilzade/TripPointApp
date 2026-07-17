import { Alert } from 'react-native';

import type { RatingTargetType } from '../types/database';
import { getErrorMessage } from './errors';
import { deleteListingAsAdminOrOwner } from './moderation';
import { supabase } from './supabase';

type DeleteResult = { error: string | null };

export function confirmDelete(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Ləğv et', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Sil', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export async function deleteListing(id: string): Promise<DeleteResult> {
  return deleteListingAsAdminOrOwner(id);
}

export async function deleteTravelHistory(id: string): Promise<DeleteResult> {
  try {
    // DB sütunu: history_id (travel_history_id deyil)
    const { error: photosError } = await supabase
      .from('travel_history_photos')
      .delete()
      .eq('history_id', id);

    if (photosError) {
      return { error: getErrorMessage(photosError) };
    }

    const { data, error } = await supabase
      .from('travel_history')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      return { error: getErrorMessage(error) };
    }
    if (!data) {
      return { error: 'Səyahət silinmədi. İcazə yoxdur və ya qeyd tapılmadı.' };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function deleteOwnRating(
  args:
    | { id: string }
    | { rater_id: string; target: { type: RatingTargetType; id: string } }
): Promise<DeleteResult> {
  try {
    let query = supabase.from('ratings').delete();

    if ('id' in args && args.id) {
      query = query.eq('id', args.id);
    } else if ('rater_id' in args) {
      query = query
        .eq('rater_id', args.rater_id)
        .eq('target_type', args.target.type)
        .eq('target_id', args.target.id);
    } else {
      return { error: 'Reytinq tapılmadı' };
    }

    const { error } = await query;
    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function deletePost(id: string): Promise<DeleteResult> {
  try {
    const { error: photosError } = await supabase.from('post_photos').delete().eq('post_id', id);
    if (photosError) {
      return { error: getErrorMessage(photosError) };
    }

    const { error } = await supabase.from('posts').delete().eq('id', id);
    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function deleteExpense(id: string): Promise<DeleteResult> {
  try {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function deleteExpenseGroup(id: string): Promise<DeleteResult> {
  try {
    const { error: expensesError } = await supabase.from('expenses').delete().eq('group_id', id);
    if (expensesError) {
      return { error: getErrorMessage(expensesError) };
    }

    const { error: membersError } = await supabase
      .from('expense_group_members')
      .delete()
      .eq('group_id', id);
    if (membersError) {
      return { error: getErrorMessage(membersError) };
    }

    const { error } = await supabase.from('expense_groups').delete().eq('id', id);
    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}
