import {assertWrap} from '@augment-vir/assert';
import {
    getObjectTypedEntries,
    getObjectTypedValues,
    mergeDefinedProperties,
    omitObjectKeys,
    randomString,
    type PartialWithUndefined,
} from '@augment-vir/common';
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
    noUserSelect,
    ViraButton,
    ViraColorVariant,
    ViraEmphasis,
    ViraIcon,
    ViraModal,
    viraShadows,
    viraTheme,
} from 'vira';
import {pdfVirIcons} from './icons.js';
import {type PagePointSize} from './page-layout.js';
import {getPdfFormAssigneeColor, type PdfFormAssignee} from './pdf-form-assignee.js';
import {
    createPdfFormField,
    pdfFormFieldConfig,
    PdfFormFieldType,
    type PdfFormField,
} from './pdf-form-field.js';
import {
    defaultPdfVirAssigneeListI18n,
    PdfVirAssigneeList,
} from './pdf-vir-assignee-list.element.js';
import {defaultPdfVirFormFieldI18n, PdfVirFormField} from './pdf-vir-form-field.element.js';
import {PdfVir, type PdfVirInputs} from './pdf-vir.element.js';

/**
 * The text {@link PdfVirFormEditor} renders when its `i18n` input leaves an entry out.
 *
 * @category Internal
 */
export const defaultPdfVirFormEditorI18n = {
    clearAll: 'Clear all',
    cancel: 'Cancel',
    clearConfirmationTitle: 'Clear all fields?',
    /** Text of the confirmation modal for clearing all form fields. */
    clearConfirmationMessage(fieldCount: number) {
        return `This removes all ${fieldCount} field${fieldCount === 1 ? '' : 's'} you've added and cannot be undone.`;
    },
    ...defaultPdfVirFormFieldI18n,
    ...defaultPdfVirAssigneeListI18n,
};

/**
 * Inputs for {@link PdfVirFormEditor}. Everything except `fields`, `assignees`, and `i18n` is passed
 * straight through to the inner {@link PdfVir}.
 *
 * @category Internal
 */
export type PdfVirFormEditorInputs = Omit<PdfVirInputs, 'renderPageOverlay'> & {
    fields: ReadonlyArray<Readonly<PdfFormField>>;
} & PartialWithUndefined<{
        /**
         * Who fields can be assigned to. When given, the palette gets a list that picks the
         * assignee of newly placed fields and can add, rename, recolor, and remove assignees
         * through `assigneesChange`. Removing an assignee also emits `fieldsChange` with that
         * assignee's fields unassigned. Each field's toolbar gets a dropdown that reassigns it, and
         * fields are colored by assignee. Omit to place unassigned fields.
         */
        assignees: ReadonlyArray<Readonly<PdfFormAssignee>>;
        i18n: Readonly<PartialWithUndefined<PdfVirFormEditorI18n>>;
    }>;

/**
 * Every piece of text {@link PdfVirFormEditor} renders, so that a consumer can translate or reword
 * it through the `i18n` input.
 *
 * @category Internal
 */
export type PdfVirFormEditorI18n = typeof defaultPdfVirFormEditorI18n;

/**
 * A form template builder: drag fields from the palette onto the PDF, then move, resize, delete, or
 * mark them required. Alt (Option) dragging a placed field duplicates it, and Delete or Backspace
 * removes the selected field.
 *
 * Controlled: every edit only emits `fieldsChange` or `assigneesChange` with the full new list.
 * Nothing changes on screen until that list is passed back in as `fields` or `assignees`.
 *
 * @category Main
 */
export const PdfVirFormEditor = defineElement<PdfVirFormEditorInputs>()({
    tagName: 'pdf-vir-form-editor',
    cssVars: {
        'pdf-vir-form-editor-palette-assignee-color':
            viraTheme.colors['vira-grey-foreground-header'].foreground.value,
    },
    styles({cssVars}) {
        return css`
            :host {
                display: flex;
                gap: 16px;
                box-sizing: border-box;
                min-height: 0;
            }

            .palette {
                display: flex;
                flex-direction: column;
                gap: 8px;
                flex-shrink: 0;
                width: 200px;
            }

            .clear-all-button {
                align-self: center;
            }

            .palette-block {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border: 1px solid
                    ${viraTheme.colors['vira-grey-behind-bg-decoration'].background.value};
                border-radius: 6px;
                background-color: ${viraTheme.colors['theme-default'].background.value};
                color: ${viraTheme.colors['theme-default'].foreground.value};
                cursor: grab;
                /* Stops a touch drag from scrolling the page instead of carrying the block. */
                touch-action: none;
                ${noUserSelect}

                &:hover {
                    border-color: ${viraTheme.colors['vira-blue-foreground-non-body'].foreground
                        .value};
                }
            }

            .palette.has-assignees .palette-block {
                border-left: 4px solid
                    ${cssVars['pdf-vir-form-editor-palette-assignee-color'].value};
            }

            ${PdfVirAssigneeList} {
                margin-bottom: 8px;
            }

            .clear-confirmation-message {
                margin: 0 0 16px;
                max-width: 400px;
            }

            .clear-confirmation-buttons {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }

            .drag-ghost {
                position: fixed;
                z-index: 1000;
                transform: translate(-50%, -50%);
                pointer-events: none;
                cursor: grabbing;
                opacity: 0.85;
                ${viraShadows.menuShadow}
            }

            ${PdfVir} {
                flex-grow: 1;
                min-width: 0;
                /* Drop the viewer's default fixed height so it stretches to this host's height. */
                height: auto;
            }
        `;
    },
    events: {
        fieldsChange: defineElementEvent<PdfFormField[]>(),
        assigneesChange: defineElementEvent<PdfFormAssignee[]>(),
    },
    state() {
        return {
            selectedFieldId: undefined as undefined | string,
            /**
             * Wrapped so that picking "Everyone", an `assigneeId` of `undefined`, differs from
             * picking nothing yet. Falls back to the first assignee while unset or no longer in
             * `assignees`.
             */
            activeAssignee: undefined as
                | undefined
                | {
                      assigneeId: string | undefined;
                  },
            isClearConfirmationOpen: false,
            paletteDrag: undefined as
                | undefined
                | {
                      type: PdfFormFieldType;
                      clientX: number;
                      clientY: number;
                  },
            paletteDragListeners: {
                current: undefined as undefined | AbortController,
            },
            outsideClickListener: {
                current: undefined as undefined | AbortController,
            },
            /**
             * The drop target layer for each page that has been mounted. A page that scrolls out of
             * the viewer's window is unmounted, leaving its entry here disconnected until the page
             * mounts again and replaces it.
             */
            pageLayers: {
                /** Keyed by page number, which object keys turn into a string. */
                current: {} as Record<string, HTMLElement>,
            },
            /** Kept apart from `pageLayers` because a page's size can arrive after its layer mounts. */
            pageSizes: {
                current: {} as Record<number, PagePointSize | undefined>,
            },
        };
    },
    render({inputs, state, updateState, dispatch, events, cssVars}) {
        const i18n = mergeDefinedProperties(defaultPdfVirFormEditorI18n, inputs.i18n);
        const assignees = inputs.assignees || [];
        const activeAssigneeId =
            state.activeAssignee &&
            (state.activeAssignee.assigneeId == undefined ||
                assignees.some((assignee) => assignee.id === state.activeAssignee?.assigneeId))
                ? state.activeAssignee.assigneeId
                : assignees[0]?.id;

        function emitFields(fields: PdfFormField[]) {
            dispatch(
                new events.fieldsChange({
                    detail: fields,
                }),
            );
        }

        function getVisiblePageLayers() {
            return getObjectTypedEntries(state.pageLayers.current)
                .map(
                    ([
                        pageNumber,
                        element,
                    ]) => {
                        return {
                            pageNumber: Number(pageNumber),
                            isConnected: element.isConnected,
                            rect: element.getBoundingClientRect(),
                        };
                    },
                )
                .filter((layer) => {
                    return layer.isConnected && layer.rect.width && layer.rect.height;
                });
        }

        function findPageLayerAt({
            clientX,
            clientY,
        }: Readonly<{
            clientX: number;
            clientY: number;
        }>) {
            return getVisiblePageLayers().find((layer) => {
                return (
                    clientX >= layer.rect.left &&
                    clientX <= layer.rect.right &&
                    clientY >= layer.rect.top &&
                    clientY <= layer.rect.bottom
                );
            });
        }

        function dropField({
            type,
            clientX,
            clientY,
        }: Readonly<{
            type: PdfFormFieldType;
            clientX: number;
            clientY: number;
        }>) {
            const target = findPageLayerAt({
                clientX,
                clientY,
            });
            if (!target) {
                return;
            }

            const newField = createPdfFormField({
                type,
                pageNumber: target.pageNumber,
                pageSize: state.pageSizes.current[target.pageNumber],
                centerX: (clientX - target.rect.left) / target.rect.width,
                centerY: (clientY - target.rect.top) / target.rect.height,
                assigneeId: activeAssigneeId,
            });
            emitFields([
                ...inputs.fields,
                newField,
            ]);
            updateState({
                selectedFieldId: newField.id,
            });
        }

        /**
         * Started from both `pointerdown` and `mousedown` because Safari gives the press that
         * follows a native `<select>` popup no `pointerdown` at all: the popup eats the release
         * that would have ended the previous pointer, so the next press arrives as a lone
         * `mousedown`. Whichever of the two comes first wins and the other is ignored.
         */
        function startPaletteDrag(type: PdfFormFieldType, event: Readonly<MouseEvent>) {
            if (event.button !== 0) {
                return;
            }
            /* Canceling this is what stops Safari from reading the drag as a text selection. */
            event.preventDefault();
            if (state.paletteDrag) {
                return;
            }

            const abortController = new AbortController();
            state.paletteDragListeners.current = abortController;

            function endDrag(endEvent: Readonly<MouseEvent>, enableDrop: boolean) {
                abortController.abort();
                state.paletteDragListeners.current = undefined;
                updateState({
                    paletteDrag: undefined,
                });
                if (enableDrop) {
                    dropField({
                        type,
                        clientX: endEvent.clientX,
                        clientY: endEvent.clientY,
                    });
                }
            }

            /*
             * The moves land on whatever is under the cursor rather than on the block, so they are
             * tracked from the window. Pointer capture is not an option: the Safari press above has
             * no pointer to capture.
             */
            window.addEventListener(
                'pointermove',
                (moveEvent) => {
                    updateState({
                        paletteDrag: {
                            type,
                            clientX: moveEvent.clientX,
                            clientY: moveEvent.clientY,
                        },
                    });
                },
                {
                    signal: abortController.signal,
                },
            );
            window.addEventListener(
                'pointerup',
                (upEvent) => {
                    endDrag(upEvent, true);
                },
                {
                    signal: abortController.signal,
                },
            );
            window.addEventListener(
                'pointercancel',
                (cancelEvent) => {
                    endDrag(cancelEvent, false);
                },
                {
                    signal: abortController.signal,
                },
            );

            updateState({
                paletteDrag: {
                    type,
                    clientX: event.clientX,
                    clientY: event.clientY,
                },
            });
        }

        function renderPaletteBlock(type: PdfFormFieldType) {
            return html`
                <${ViraIcon.assign({
                    icon: pdfFormFieldConfig[type].icon,
                })}></${ViraIcon}>
                ${i18n.fieldTypeLabels[type]}
            `;
        }

        /**
         * Draws the field that dropping will place, at its size on the page under the cursor. Off
         * the pages it takes the size it would have on the first visible page, and before any page
         * has rendered it falls back to the palette block.
         */
        function renderDragGhost(
            drag: Readonly<{
                type: PdfFormFieldType;
                clientX: number;
                clientY: number;
            }>,
        ) {
            const sizingLayer = findPageLayerAt(drag) || getVisiblePageLayers()[0];

            if (!sizingLayer) {
                return html`
                    <div
                        class="palette-block drag-ghost"
                        style=${css`
                            left: ${drag.clientX}px;
                            top: ${drag.clientY}px;
                        `}
                    >
                        ${renderPaletteBlock(drag.type)}
                    </div>
                `;
            }

            const ghostField = createPdfFormField({
                type: drag.type,
                pageNumber: sizingLayer.pageNumber,
                pageSize: state.pageSizes.current[sizingLayer.pageNumber],
                centerX: 0.5,
                centerY: 0.5,
                assigneeId: activeAssigneeId,
            });

            return html`
                <div
                    class="drag-ghost"
                    style=${css`
                        left: ${drag.clientX}px;
                        top: ${drag.clientY}px;
                        width: ${ghostField.width * sizingLayer.rect.width}px;
                        height: ${ghostField.height * sizingLayer.rect.height}px;
                    `}
                >
                    <${PdfVirFormField.assign({
                        field: {
                            ...ghostField,
                            x: 0,
                            y: 0,
                            width: 1,
                            height: 1,
                        },
                        isSelected: false,
                        assignees,
                        i18n,
                    })}></${PdfVirFormField}>
                </div>
            `;
        }

        return html`
            <div
                class="palette ${assignees.length ? 'has-assignees' : ''}"
                style=${css`
                    ${cssVars['pdf-vir-form-editor-palette-assignee-color']
                        .name}: ${getPdfFormAssigneeColor({
                        assignees,
                        assigneeId: activeAssigneeId,
                    }).uiAccent};
                `}
            >
                ${inputs.assignees
                    ? html`
                          <${PdfVirAssigneeList.assign({
                              assignees: inputs.assignees,
                              activeAssigneeId,
                              i18n,
                          })}
                              ${listen(PdfVirAssigneeList.events.assigneesChange, (event) => {
                                  const remainingIds = event.detail.map((assignee) => assignee.id);
                                  const orphanedFields = inputs.fields.filter((field) => {
                                      return (
                                          !!field.assigneeId &&
                                          assignees.some(
                                              (assignee) => assignee.id === field.assigneeId,
                                          ) &&
                                          !remainingIds.includes(field.assigneeId)
                                      );
                                  });

                                  if (orphanedFields.length) {
                                      emitFields(
                                          inputs.fields.map((field) => {
                                              return orphanedFields.includes(field)
                                                  ? omitObjectKeys(field, ['assigneeId'])
                                                  : field;
                                          }),
                                      );
                                  }
                                  dispatch(
                                      new events.assigneesChange({
                                          detail: event.detail,
                                      }),
                                  );
                              })}
                              ${listen(PdfVirAssigneeList.events.activeAssigneeChange, (event) => {
                                  updateState({
                                      activeAssignee: {
                                          assigneeId: event.detail,
                                      },
                                  });
                              })}
                          ></${PdfVirAssigneeList}>
                      `
                    : nothing}
                ${getObjectTypedValues(PdfFormFieldType).map((type) => {
                    return html`
                        <div
                            class="palette-block"
                            ${listen('pointerdown', (event) => {
                                startPaletteDrag(type, event);
                            })}
                            ${listen('mousedown', (event) => {
                                startPaletteDrag(type, event);
                            })}
                        >
                            ${renderPaletteBlock(type)}
                        </div>
                    `;
                })}
                <${ViraButton.assign({
                    text: i18n.clearAll,
                    icon: pdfVirIcons.trash,
                    color: ViraColorVariant.Danger,
                    buttonEmphasis: ViraEmphasis.Subtle,
                    isDisabled: !inputs.fields.length,
                })}
                    class="clear-all-button"
                    ${listen('click', () => {
                        updateState({
                            isClearConfirmationOpen: true,
                        });
                    })}
                ></${ViraButton}>
            </div>
            <${PdfVir.assign({
                ...omitObjectKeys(inputs, [
                    'fields',
                    'assignees',
                    'i18n',
                ]),
                renderPageOverlay({pageNumber, pageSize}) {
                    state.pageSizes.current[pageNumber] = pageSize;
                    return html`
                        <div
                            style=${css`
                                position: absolute;
                                inset: 0;
                            `}
                            ${onDomCreated((element) => {
                                state.pageLayers.current[pageNumber] = assertWrap.instanceOf(
                                    element,
                                    HTMLElement,
                                );
                            })}
                            ${listen('click', () => {
                                updateState({
                                    selectedFieldId: undefined,
                                });
                            })}
                        >
                            ${repeat(
                                inputs.fields.filter((field) => {
                                    return field.pageNumber === pageNumber;
                                }),
                                (field) => field.id,
                                (field) => {
                                    return html`
                                        <${PdfVirFormField.assign({
                                            field,
                                            isSelected: field.id === state.selectedFieldId,
                                            assignees,
                                            i18n,
                                        })}
                                            ${listen(
                                                PdfVirFormField.events.fieldChange,
                                                (event) => {
                                                    emitFields(
                                                        inputs.fields.map((existingField) => {
                                                            return existingField.id ===
                                                                event.detail.id
                                                                ? event.detail
                                                                : existingField;
                                                        }),
                                                    );
                                                },
                                            )}
                                            ${listen(
                                                PdfVirFormField.events.fieldDuplicate,
                                                (event) => {
                                                    emitFields([
                                                        ...inputs.fields.map((existingField) => {
                                                            return existingField.id ===
                                                                event.detail.id
                                                                ? event.detail
                                                                : existingField;
                                                        }),
                                                        {
                                                            ...field,
                                                            id: randomString(),
                                                        },
                                                    ]);
                                                },
                                            )}
                                            ${listen(PdfVirFormField.events.fieldSelect, () => {
                                                updateState({
                                                    selectedFieldId: field.id,
                                                });
                                            })}
                                            ${listen(PdfVirFormField.events.fieldDelete, () => {
                                                emitFields(
                                                    inputs.fields.filter((existingField) => {
                                                        return existingField.id !== field.id;
                                                    }),
                                                );
                                                updateState({
                                                    selectedFieldId: undefined,
                                                });
                                            })}
                                        ></${PdfVirFormField}>
                                    `;
                                },
                            )}
                        </div>
                    `;
                },
            })}></${PdfVir}>
            ${state.paletteDrag ? renderDragGhost(state.paletteDrag) : nothing}
            <${ViraModal.assign({
                open: state.isClearConfirmationOpen,
                modalTitle: i18n.clearConfirmationTitle,
            })}
                ${listen(ViraModal.events.modalClose, () => {
                    updateState({
                        isClearConfirmationOpen: false,
                    });
                })}
            >
                <p class="clear-confirmation-message">
                    ${i18n.clearConfirmationMessage(inputs.fields.length)}
                </p>
                <div class="clear-confirmation-buttons">
                    <${ViraButton.assign({
                        text: i18n.cancel,
                        buttonEmphasis: ViraEmphasis.Subtle,
                    })}
                        ${listen('click', () => {
                            updateState({
                                isClearConfirmationOpen: false,
                            });
                        })}
                    ></${ViraButton}>
                    <${ViraButton.assign({
                        text: i18n.clearAll,
                        icon: pdfVirIcons.trash,
                        color: ViraColorVariant.Danger,
                    })}
                        ${listen('click', () => {
                            emitFields([]);
                            updateState({
                                selectedFieldId: undefined,
                                isClearConfirmationOpen: false,
                            });
                        })}
                    ></${ViraButton}>
                </div>
            </${ViraModal}>
        `;
    },
    init({state, updateState}) {
        const abortController = new AbortController();
        state.outsideClickListener.current = abortController;
        /**
         * Listens on the window so that a press anywhere on the page, even outside this element,
         * deselects. Fields select themselves, so presses on any field are left alone.
         */
        window.addEventListener(
            'pointerdown',
            (event) => {
                if (
                    state.selectedFieldId &&
                    !event.composedPath().some((target) => {
                        return (
                            target instanceof HTMLElement &&
                            target.tagName === PdfVirFormField.tagName.toUpperCase()
                        );
                    })
                ) {
                    updateState({
                        selectedFieldId: undefined,
                    });
                }
            },
            {
                signal: abortController.signal,
            },
        );
    },
    cleanup({state}) {
        state.paletteDragListeners.current?.abort();
        state.outsideClickListener.current?.abort();
    },
});
