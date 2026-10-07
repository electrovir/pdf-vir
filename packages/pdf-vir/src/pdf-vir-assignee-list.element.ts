import {assertWrap} from '@augment-vir/assert';
import {mergeDefinedProperties, randomString, type PartialWithUndefined} from '@augment-vir/common';
import {
    css,
    defineElement,
    defineElementEvent,
    html,
    listen,
    nothing,
    onDomCreated,
    repeat,
} from 'element-vir';
import {
    ViraButton,
    ViraColorVariant,
    ViraEmphasis,
    ViraInput,
    viraTheme,
    ViraThemeColorName,
} from 'vira';
import {pdfVirIcons} from './icons.js';
import {
    getPdfFormAssigneeColorValues,
    pdfFormAssigneeColors,
    pickNewPdfFormAssigneeColor,
    resolvePdfFormAssigneeColors,
    type PdfFormAssignee,
    type PdfFormAssigneeColor,
} from './pdf-form-assignee.js';

/**
 * The text {@link PdfVirAssigneeList} renders when its `i18n` input leaves an entry out.
 *
 * @category Internal
 */
export const defaultPdfVirAssigneeListI18n = {
    /** Heading of the list that picks who newly placed fields are assigned to. */
    assignTo: 'Assign to',
    /** The list entry that places fields assigned to no one, which anyone can fill. */
    everyone: 'Everyone',
    addAssignee: 'Add signer',
    /** Name given to a newly added assignee, by its position in the list. */
    newAssigneeLabel(position: number) {
        return `Signer ${position}`;
    },
    editAssignee: 'Edit signer',
    saveAssignee: 'Save signer',
    deleteAssignee: 'Remove signer',
    assigneeName: 'Signer name',
    assigneeColorLabels: {
        [ViraThemeColorName.blue]: 'Blue',
        [ViraThemeColorName.purple]: 'Purple',
        [ViraThemeColorName.green]: 'Green',
        [ViraThemeColorName.pink]: 'Pink',
        [ViraThemeColorName.teal]: 'Teal',
        [ViraThemeColorName.yellow]: 'Yellow',
    } satisfies Record<PdfFormAssigneeColor, string>,
};

/**
 * Every piece of text {@link PdfVirAssigneeList} renders.
 *
 * @category Internal
 */
export type PdfVirAssigneeListI18n = typeof defaultPdfVirAssigneeListI18n;

/**
 * The list of assignees in `PdfVirFormEditor`'s palette. Picks the active assignee, adds assignees,
 * and edits an assignee's name and color after its pencil button is clicked. The first entry,
 * "Everyone", picks no assignee.
 *
 * Controlled: changes only emit `assigneesChange` or `activeAssigneeChange`.
 *
 * @category Internal
 */
export const PdfVirAssigneeList = defineElement<
    {
        assignees: ReadonlyArray<Readonly<PdfFormAssignee>>;
    } & PartialWithUndefined<{
        activeAssigneeId: string;
        i18n: Readonly<PartialWithUndefined<PdfVirAssigneeListI18n>>;
    }>
>()({
    tagName: 'pdf-vir-assignee-list',
    styles: css`
        :host {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 2px;
        }

        .heading,
        .add-button {
            grid-column: 1 / -1;
        }

        .heading {
            font-weight: bold;
            margin-bottom: 2px;
        }

        .add-button {
            justify-self: start;
        }

        .edit-button {
            ${ViraButton.cssVars['vira-button-text-color'].name}: ${viraTheme.colors[
                'vira-grey-foreground-placeholder'
            ].foreground.value};
        }

        .assignee-row {
            /* Keeps the row after "Everyone", which has no edit button, out of that empty column. */
            grid-column: 1;
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            min-height: 28px;
            padding: 0 6px 0 8px;
            border: 1px solid transparent;
            border-radius: 6px;
            cursor: pointer;

            &.active {
                border-color: ${viraTheme.colors['vira-blue-foreground-non-body'].foreground.value};
            }

            & ${ViraInput} {
                flex-grow: 1;
                min-width: 0;
            }
        }

        .assignee-swatch {
            flex-shrink: 0;
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }

        .assignee-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;

            &.everyone {
                color: ${viraTheme.colors['vira-grey-foreground-placeholder'].foreground.value};
            }
        }

        .color-options {
            grid-column: 1;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px;
            padding: 0 6px;
        }

        .color-option {
            box-sizing: border-box;
            width: 16px;
            height: 16px;
            padding: 0;
            border: 2px solid transparent;
            border-radius: 50%;
            background-clip: content-box;
            cursor: pointer;

            &.selected {
                border-color: ${viraTheme.colors['theme-default'].foreground.value};
            }
        }
    `,
    events: {
        assigneesChange: defineElementEvent<PdfFormAssignee[]>(),
        /** `undefined` when everyone is picked. */
        activeAssigneeChange: defineElementEvent<string | undefined>(),
    },
    state() {
        return {
            /** The assignee whose name and color are being edited, with its unsaved name. */
            editing: undefined as
                | undefined
                | {
                      assigneeId: string;
                      label: string;
                  },
        };
    },
    render({inputs, state, updateState, dispatch, events}) {
        const i18n = mergeDefinedProperties(defaultPdfVirAssigneeListI18n, inputs.i18n);
        const resolvedColors = resolvePdfFormAssigneeColors(inputs.assignees);

        function emitAssignees(newAssignees: PdfFormAssignee[]) {
            dispatch(
                new events.assigneesChange({
                    detail: newAssignees,
                }),
            );
        }

        function updateAssignee(changedAssignee: Readonly<PdfFormAssignee>) {
            emitAssignees(
                inputs.assignees.map((assignee) => {
                    return assignee.id === changedAssignee.id ? changedAssignee : assignee;
                }),
            );
        }

        function selectAssignee(assigneeId: string | undefined) {
            dispatch(
                new events.activeAssigneeChange({
                    detail: assigneeId,
                }),
            );
        }

        /** Saves the unsaved name, unless it is blank, and closes the editor. */
        function finishEditing() {
            const editedAssignee = inputs.assignees.find((assignee) => {
                return assignee.id === state.editing?.assigneeId;
            });
            const label = state.editing?.label.trim();

            if (editedAssignee && label && label !== editedAssignee.label) {
                updateAssignee({
                    ...editedAssignee,
                    label,
                });
            }
            updateState({
                editing: undefined,
            });
        }

        function addAssignee() {
            const newAssignee: PdfFormAssignee = {
                id: randomString(),
                label: i18n.newAssigneeLabel(inputs.assignees.length + 1),
                color: pickNewPdfFormAssigneeColor(inputs.assignees),
            };
            finishEditing();
            updateState({
                editing: {
                    assigneeId: newAssignee.id,
                    label: newAssignee.label,
                },
            });
            emitAssignees([
                ...inputs.assignees,
                newAssignee,
            ]);
            selectAssignee(newAssignee.id);
        }

        function renderEditOptions(
            assignee: Readonly<PdfFormAssignee>,
            selectedColor: PdfFormAssigneeColor,
        ) {
            return html`
                <div class="color-options">
                    ${pdfFormAssigneeColors.map((color) => {
                        return html`
                            <button
                                class="color-option ${color === selectedColor ? 'selected' : ''}"
                                title=${i18n.assigneeColorLabels[color]}
                                aria-label=${i18n.assigneeColorLabels[color]}
                                aria-pressed=${color === selectedColor}
                                style=${css`
                                    background-color: ${getPdfFormAssigneeColorValues(color)
                                        .uiAccent};
                                `}
                                ${listen('click', () => {
                                    updateAssignee({
                                        ...assignee,
                                        color,
                                    });
                                })}
                            ></button>
                        `;
                    })}
                </div>
                <${ViraButton.assign({
                    icon: pdfVirIcons.trash,
                    buttonEmphasis: ViraEmphasis.Subtle,
                    color: ViraColorVariant.Danger,
                })}
                    title=${i18n.deleteAssignee}
                    ${listen('click', () => {
                        updateState({
                            editing: undefined,
                        });
                        emitAssignees(
                            inputs.assignees.filter((existingAssignee) => {
                                return existingAssignee.id !== assignee.id;
                            }),
                        );
                    })}
                ></${ViraButton}>
            `;
        }

        return html`
            <span class="heading">${i18n.assignTo}</span>
            <div
                class="assignee-row ${inputs.activeAssigneeId == undefined ? 'active' : ''}"
                ${listen('click', () => {
                    finishEditing();
                    selectAssignee(undefined);
                })}
            >
                <span
                    class="assignee-swatch"
                    style=${css`
                        background-color: ${viraTheme.colors['vira-grey-foreground-placeholder']
                            .foreground.value};
                    `}
                ></span>
                <span class="assignee-name everyone">${i18n.everyone}</span>
            </div>
            ${repeat(
                inputs.assignees,
                (assignee) => assignee.id,
                (assignee, index) => {
                    const color = assertWrap.isDefined(resolvedColors[index]);
                    const editingLabel =
                        state.editing?.assigneeId === assignee.id ? state.editing.label : undefined;

                    return html`
                        <div
                            class="assignee-row ${assignee.id === inputs.activeAssigneeId &&
                            editingLabel == undefined
                                ? 'active'
                                : ''}"
                            ${listen('click', () => {
                                selectAssignee(assignee.id);
                            })}
                        >
                            <span
                                class="assignee-swatch"
                                style=${css`
                                    background-color: ${getPdfFormAssigneeColorValues(color)
                                        .uiAccent};
                                `}
                            ></span>
                            ${editingLabel == undefined
                                ? html`
                                      <span class="assignee-name">${assignee.label}</span>
                                  `
                                : html`
                                      <${ViraInput.assign({
                                          value: editingLabel,
                                          placeholder: i18n.assigneeName,
                                          attributePassthrough: {
                                              'aria-label': i18n.assigneeName,
                                          },
                                      })}
                                          ${onDomCreated((element) => {
                                              const input =
                                                  element.shadowRoot?.querySelector('input');
                                              input?.focus();
                                              input?.select();
                                          })}
                                          ${listen(ViraInput.events.valueChange, (event) => {
                                              updateState({
                                                  editing: {
                                                      assigneeId: assignee.id,
                                                      label: event.detail,
                                                  },
                                              });
                                          })}
                                          ${listen('keydown', (event) => {
                                              if (event.key === 'Enter') {
                                                  finishEditing();
                                              } else if (event.key === 'Escape') {
                                                  updateState({
                                                      editing: undefined,
                                                  });
                                              }
                                          })}
                                      ></${ViraInput}>
                                  `}
                        </div>
                        <${ViraButton.assign({
                            icon: editingLabel == undefined ? pdfVirIcons.edit : pdfVirIcons.save,
                            buttonEmphasis: ViraEmphasis.Subtle,
                            color:
                                editingLabel == undefined
                                    ? ViraColorVariant.Neutral
                                    : ViraColorVariant.Positive,
                        })}
                            class=${editingLabel == undefined ? 'edit-button' : ''}
                            title=${editingLabel == undefined
                                ? i18n.editAssignee
                                : i18n.saveAssignee}
                            ${listen('click', () => {
                                if (editingLabel == undefined) {
                                    finishEditing();
                                    updateState({
                                        editing: {
                                            assigneeId: assignee.id,
                                            label: assignee.label,
                                        },
                                    });
                                    selectAssignee(assignee.id);
                                } else {
                                    finishEditing();
                                }
                            })}
                        ></${ViraButton}>
                        ${editingLabel == undefined ? nothing : renderEditOptions(assignee, color)}
                    `;
                },
            )}
            <${ViraButton.assign({
                text: i18n.addAssignee,
                icon: pdfVirIcons.add,
                buttonEmphasis: ViraEmphasis.Subtle,
            })}
                class="add-button"
                ${listen('click', addAssignee)}
            ></${ViraButton}>
        `;
    },
});
