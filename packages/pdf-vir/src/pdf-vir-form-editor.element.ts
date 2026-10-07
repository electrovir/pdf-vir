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
import {pdfFormCssVars} from './pdf-form-css-vars.js';
import {
    createPdfFormField,
    getPdfFormFieldBoxBounds,
    movePdfFormFieldBoxes,
    pdfFormFieldConfig,
    PdfFormFieldType,
    type PdfFormField,
} from './pdf-form-field.js';
import {
    defaultPdfVirAssigneeListI18n,
    PdfVirAssigneeList,
} from './pdf-vir-assignee-list.element.js';
import {
    defaultPdfVirFormFieldI18n,
    PdfFormFieldSelection,
    PdfVirFormField,
} from './pdf-vir-form-field.element.js';
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
 * mark them required. Shift clicking fields or dragging a box across a page with the mouse selects
 * several fields at once, which then move, duplicate, delete, and take toolbar changes together.
 * Alt (Option) dragging a placed field duplicates the selection, and Delete or Backspace removes
 * it.
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
            /** The last id is the field that shows the selection's toolbar. */
            selectedFieldIds: [] as string[],
            /** The selection box being dragged across a page, in fractions of that page. */
            marquee: undefined as
                | undefined
                | {
                      pageNumber: number;
                      pointerId: number;
                      startX: number;
                      startY: number;
                      endX: number;
                      endY: number;
                      /** Kept selected regardless of the box, from a Shift drag. */
                      baseSelectedFieldIds: string[];
                  },
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

        const selectedFields = inputs.fields.filter((field) => {
            return state.selectedFieldIds.includes(field.id);
        });
        const controlsFieldId = state.selectedFieldIds.findLast((id) => {
            return selectedFields.some((field) => field.id === id);
        });

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
                selectedFieldIds: [newField.id],
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

        /**
         * Applies an edit of one field to the whole selection when that field is part of it: its
         * move shifts every selected field and its "Required?" and assignee changes are copied to
         * them, while a resize stays on that field alone.
         */
        function applyFieldChange(changedField: Readonly<PdfFormField>) {
            const previousField = inputs.fields.find((field) => field.id === changedField.id);
            if (!previousField || !selectedFields.includes(previousField)) {
                return inputs.fields.map((field) => {
                    return field.id === changedField.id ? changedField : field;
                });
            }

            const sharedChanges: Partial<Pick<PdfFormField, 'isRequired' | 'assigneeId'>> = {
                ...(changedField.isRequired === previousField.isRequired
                    ? {}
                    : {
                          isRequired: changedField.isRequired,
                      }),
                ...(changedField.assigneeId === previousField.assigneeId
                    ? {}
                    : {
                          assigneeId: changedField.assigneeId,
                      }),
            };
            const movedFields = movePdfFormFieldBoxes({
                boxes: selectedFields.map((field) => {
                    return field === previousField
                        ? {
                              ...changedField,
                              x: previousField.x,
                              y: previousField.y,
                          }
                        : field;
                }),
                deltaX: changedField.x - previousField.x,
                deltaY: changedField.y - previousField.y,
            });

            return inputs.fields.map((field) => {
                const movedField = movedFields.find((moved) => moved.id === field.id);
                return movedField
                    ? {
                          ...movedField,
                          ...sharedChanges,
                      }
                    : field;
            });
        }

        function selectField(fieldId: string, selection: PdfFormFieldSelection) {
            const isSelected = selectedFields.some((field) => field.id === fieldId);
            const otherIds = state.selectedFieldIds.filter((id) => id !== fieldId);

            const selectionHandlers: Record<PdfFormFieldSelection, () => string[]> = {
                [PdfFormFieldSelection.Only]() {
                    return [fieldId];
                },
                [PdfFormFieldSelection.Grab]() {
                    return isSelected
                        ? [
                              ...otherIds,
                              fieldId,
                          ]
                        : [fieldId];
                },
                [PdfFormFieldSelection.Toggle]() {
                    return isSelected
                        ? otherIds
                        : [
                              ...otherIds,
                              fieldId,
                          ];
                },
            };

            updateState({
                selectedFieldIds: selectionHandlers[selection](),
            });
        }

        function deleteSelectedFields() {
            if (!selectedFields.length) {
                return;
            }
            emitFields(
                inputs.fields.filter((field) => {
                    return !selectedFields.includes(field);
                }),
            );
            updateState({
                selectedFieldIds: [],
            });
        }

        function readPagePoint(event: Readonly<PointerEvent>, layer: Readonly<HTMLElement>) {
            const rect = layer.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) / rect.width,
                y: (event.clientY - rect.top) / rect.height,
            };
        }

        function updateMarquee(event: Readonly<PointerEvent>, layer: Readonly<HTMLElement>) {
            const marquee = state.marquee;
            if (marquee?.pointerId !== event.pointerId) {
                return;
            }
            const end = readPagePoint(event, layer);
            const left = Math.min(marquee.startX, end.x);
            const right = Math.max(marquee.startX, end.x);
            const top = Math.min(marquee.startY, end.y);
            const bottom = Math.max(marquee.startY, end.y);

            const touchedIds = inputs.fields
                .filter((field) => {
                    return (
                        field.pageNumber === marquee.pageNumber &&
                        field.x < right &&
                        field.x + field.width > left &&
                        field.y < bottom &&
                        field.y + field.height > top
                    );
                })
                .map((field) => field.id);

            updateState({
                marquee: {
                    ...marquee,
                    endX: end.x,
                    endY: end.y,
                },
                selectedFieldIds: [
                    ...marquee.baseSelectedFieldIds.filter((id) => !touchedIds.includes(id)),
                    ...touchedIds,
                ],
            });
        }

        /** Only exists while several fields are selected, so a lone field keeps its own border. */
        function getSelectionBox(pageNumber: number) {
            const pageFields = selectedFields.filter((field) => field.pageNumber === pageNumber);
            return selectedFields.length > 1 && pageFields.length
                ? getPdfFormFieldBoxBounds(pageFields)
                : undefined;
        }

        function renderSelectionBorder(pageNumber: number) {
            const selectionBox = getSelectionBox(pageNumber);
            if (!selectionBox) {
                return nothing;
            }

            return html`
                <div
                    style=${css`
                        position: absolute;
                        z-index: 1;
                        left: ${selectionBox.x * 100}%;
                        top: ${selectionBox.y * 100}%;
                        width: ${selectionBox.width * 100}%;
                        height: ${selectionBox.height * 100}%;
                        outline: 2px dotted ${pdfFormCssVars['pdf-vir-field-accent-color'].value};
                        outline-offset: 4px;
                        pointer-events: none;
                    `}
                ></div>
            `;
        }

        function renderMarquee(pageNumber: number) {
            const marquee = state.marquee;
            if (marquee?.pageNumber !== pageNumber) {
                return nothing;
            }

            return html`
                <div
                    style=${css`
                        position: absolute;
                        left: ${Math.min(marquee.startX, marquee.endX) * 100}%;
                        top: ${Math.min(marquee.startY, marquee.endY) * 100}%;
                        width: ${Math.abs(marquee.endX - marquee.startX) * 100}%;
                        height: ${Math.abs(marquee.endY - marquee.startY) * 100}%;
                        box-sizing: border-box;
                        border: 1px solid ${pdfFormCssVars['pdf-vir-field-accent-color'].value};
                        background-color: color-mix(
                            in srgb,
                            ${pdfFormCssVars['pdf-vir-field-accent-color'].value} 12%,
                            transparent
                        );
                        pointer-events: none;
                    `}
                ></div>
            `;
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
                            tabindex="-1"
                            style=${css`
                                position: absolute;
                                inset: 0;
                                outline: none;
                                ${noUserSelect}
                            `}
                            ${onDomCreated((element) => {
                                state.pageLayers.current[pageNumber] = assertWrap.instanceOf(
                                    element,
                                    HTMLElement,
                                );
                            })}
                            ${listen('pointerdown', (event) => {
                                /* Touch presses are left alone so they can still scroll and pinch. */
                                if (event.button !== 0 || event.pointerType === 'touch') {
                                    return;
                                }
                                const layer = assertWrap.instanceOf(
                                    event.currentTarget,
                                    HTMLElement,
                                );
                                layer.setPointerCapture(event.pointerId);
                                const start = readPagePoint(event, layer);
                                const baseSelectedFieldIds = event.shiftKey
                                    ? state.selectedFieldIds
                                    : [];
                                updateState({
                                    marquee: {
                                        pageNumber,
                                        pointerId: event.pointerId,
                                        startX: start.x,
                                        startY: start.y,
                                        endX: start.x,
                                        endY: start.y,
                                        baseSelectedFieldIds,
                                    },
                                    selectedFieldIds: baseSelectedFieldIds,
                                });
                            })}
                            ${listen('pointermove', (event) => {
                                updateMarquee(
                                    event,
                                    assertWrap.instanceOf(event.currentTarget, HTMLElement),
                                );
                            })}
                            ${listen('pointerup', (event) => {
                                if (state.marquee?.pointerId === event.pointerId) {
                                    updateState({
                                        marquee: undefined,
                                    });
                                }
                            })}
                            ${listen('pointercancel', (event) => {
                                if (state.marquee?.pointerId === event.pointerId) {
                                    updateState({
                                        marquee: undefined,
                                    });
                                }
                            })}
                            ${listen('keydown', (event) => {
                                /* Keys pressed on a field are handled by its `fieldDelete`. */
                                if (
                                    event.target === event.currentTarget &&
                                    (event.key === 'Delete' || event.key === 'Backspace')
                                ) {
                                    event.preventDefault();
                                    deleteSelectedFields();
                                }
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
                                            isSelected: selectedFields.includes(field),
                                            showControls: field.id === controlsFieldId,
                                            selectionBox:
                                                field.id === controlsFieldId
                                                    ? getSelectionBox(pageNumber)
                                                    : undefined,
                                            assignees,
                                            i18n,
                                        })}
                                            ${listen(
                                                PdfVirFormField.events.fieldChange,
                                                (event) => {
                                                    emitFields(applyFieldChange(event.detail));
                                                },
                                            )}
                                            ${listen(
                                                PdfVirFormField.events.fieldDuplicate,
                                                (event) => {
                                                    const originals = selectedFields.includes(field)
                                                        ? selectedFields
                                                        : [field];
                                                    emitFields([
                                                        ...applyFieldChange(event.detail),
                                                        ...originals.map((original) => {
                                                            return {
                                                                ...original,
                                                                id: randomString(),
                                                            };
                                                        }),
                                                    ]);
                                                },
                                            )}
                                            ${listen(
                                                PdfVirFormField.events.fieldSelect,
                                                (event) => {
                                                    selectField(field.id, event.detail);
                                                },
                                            )}
                                            ${listen(
                                                PdfVirFormField.events.fieldDelete,
                                                deleteSelectedFields,
                                            )}
                                        ></${PdfVirFormField}>
                                    `;
                                },
                            )}
                            ${renderSelectionBorder(pageNumber)} ${renderMarquee(pageNumber)}
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
                                selectedFieldIds: [],
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
         * deselects. Fields and page layers manage the selection themselves, so presses on them are
         * left alone.
         */
        window.addEventListener(
            'pointerdown',
            (event) => {
                const pageLayers = getObjectTypedValues(state.pageLayers.current);
                if (
                    state.selectedFieldIds.length &&
                    !event.composedPath().some((target) => {
                        return (
                            target instanceof HTMLElement &&
                            (target.tagName === PdfVirFormField.tagName.toUpperCase() ||
                                pageLayers.includes(target))
                        );
                    })
                ) {
                    updateState({
                        selectedFieldIds: [],
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
